import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { afterCollectionFailed } from '@/lib/direct-debit/after-collection';
import {
  onPayRequestFulfilled,
  onPayRequestPayment,
  type GcBillingRequest,
} from '@/lib/gocardless/pay-by-bank';
import { GoCardlessError, isRevokedError, type GoCardlessClient } from '@/lib/gocardless/client';
import {
  clientForTenant,
  connectionStatus,
  getConnection,
  markDisconnected,
  refreshVerification,
} from '@/lib/gocardless/connection';
import { formatGbp, fromPence } from '@/lib/money/pence';
import { sendOrHoldOwnerPush, type OwnerPush } from '@/lib/push/owner-push';
import { londonDayBoundsUtc, todayInLondon } from '@/lib/rounds/dates';

export type GcEvent = {
  id: string | null;
  created_at: string;
  resource_type: string;
  action: string;
  links: Record<string, string | undefined>;
  details?: { origin?: string; cause?: string; description?: string; reason_code?: string };
  metadata?: Record<string, string>;
};

type Row = Record<string, unknown>;

const DEFAULT_OLDER_THAN_MS = 2 * 60 * 1000;
const DEFAULT_LIMIT = 200;
const MAX_ATTEMPTS = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

function dbFail(label: string, error: { code?: string; message?: string }): Error {
  return new Error(`${label} failed (${error.code ?? 'db'})`);
}

// ---------------------------------------------------------------------------
// Storing

function eventKey(event: GcEvent): string | null {
  const id = str(event.id);
  if (id) return id;
  const organisation = str(event.links?.organisation);
  if (!organisation) return null;
  return `disconnect_${organisation}_${str(event.created_at) ?? 'unknown'}`;
}

/** Stores events (id null → `disconnect_<organisation>_<created_at>`), tenant from links.organisation. Returns the stored ids (new and already-there, not yet processed). */
export async function storeGoCardlessEvents(
  admin: SupabaseClient,
  events: GcEvent[],
): Promise<string[]> {
  const usable = events.filter(
    (event) => isRecord(event) && str(event.resource_type) && str(event.action) && eventKey(event),
  );
  if (usable.length === 0) return [];

  const organisations = [
    ...new Set(usable.map((e) => str(e.links?.organisation)).filter((o): o is string => o != null)),
  ];
  const tenantByOrganisation = new Map<string, string>();
  if (organisations.length > 0) {
    const { data, error } = await admin
      .from('gocardless_connections')
      .select('tenant_id, organisation_id, status')
      .in('organisation_id', organisations);
    if (error) throw dbFail('Reading connections', error);
    const rows = (data ?? []) as Row[];
    // A connected row wins over an old disconnected one for the same organisation.
    for (const row of [...rows].sort((a, b) => (a.status === 'connected' ? 1 : 0) - (b.status === 'connected' ? 1 : 0))) {
      const organisation = str(row.organisation_id);
      const tenant = str(row.tenant_id);
      if (organisation && tenant) tenantByOrganisation.set(organisation, tenant);
    }
  }

  const byKey = new Map<string, Row>();
  for (const event of usable) {
    const id = eventKey(event) as string;
    const organisation = str(event.links?.organisation);
    const resourceType = String(event.resource_type);
    byKey.set(id, {
      id,
      organisation_id: organisation,
      tenant_id: organisation ? (tenantByOrganisation.get(organisation) ?? null) : null,
      resource_type: resourceType,
      action: String(event.action),
      resource_id: str(event.links?.[resourceType.replace(/s$/, '')]) ?? null,
      payload: event,
    });
  }

  const { error } = await admin
    .from('gocardless_events')
    .upsert([...byKey.values()], { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw dbFail('Storing events', error);
  return [...byKey.keys()];
}

// ---------------------------------------------------------------------------
// Processing

type Ctx = {
  admin: SupabaseClient;
  tenantId: string;
  client: GoCardlessClient;
  event: GcEvent;
  /** gocardless_events.id of the event being processed. */
  eventRowId: string;
  /** The business's GoCardless organisation (for rows rebuilt from metadata). */
  organisationId: string | null;
  now: Date;
};
type PushCtx = Omit<Ctx, 'client'>;

type GcMandate = {
  id?: string;
  status?: string;
  reference?: string;
  next_possible_charge_date?: string;
  links?: { customer_bank_account?: string; customer?: string };
};

type GcPayment = {
  id?: string;
  status?: string;
  amount?: number;
  amount_refunded?: number;
  charge_date?: string;
  metadata?: Record<string, string>;
  links?: { mandate?: string };
};

const INACTIVE_REASONS: Record<string, string> = {
  failed: "Their bank didn't accept it",
  blocked: 'Blocked by GoCardless',
  expired: 'Not used for over a year, so it expired',
  cancelled: 'Cancelled',
};

async function push(
  ctx: PushCtx,
  kind: OwnerPush['kind'],
  title: string,
  body: string,
  data: Omit<OwnerPush['data'], 'type'> = {},
): Promise<void> {
  await sendOrHoldOwnerPush(
    ctx.admin,
    ctx.tenantId,
    { kind, title, body, data: { type: kind, ...data } },
    ctx.now,
  );
}

async function customerName(ctx: PushCtx, customerId: string | null): Promise<string> {
  if (!customerId) return 'A customer';
  const { data } = await ctx.admin
    .from('customers')
    .select('name')
    .eq('id', customerId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  return str((data as Row | null)?.name) ?? 'A customer';
}

/** Rows an update touched (the update must .select('id')). */
function touched(result: { data: unknown; error: { code?: string; message?: string } | null }, label: string): number {
  if (result.error) throw dbFail(label, result.error);
  return Array.isArray(result.data) ? result.data.length : 0;
}

async function ddRowByMandate(ctx: Ctx, mandateId: string): Promise<Row | null> {
  const { data, error } = await ctx.admin
    .from('customer_direct_debits')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .eq('gocardless_mandate_id', mandateId)
    .maybeSingle();
  if (error) throw dbFail('Reading Direct Debit', error);
  return (data as Row | null) ?? null;
}

async function bankAccount(
  ctx: Ctx,
  mandate: GcMandate,
): Promise<{ bank_name: string | null; account_number_ending: string | null }> {
  const id = str(mandate.links?.customer_bank_account);
  if (!id) return { bank_name: null, account_number_ending: null };
  const json = await ctx.client.get<{ customer_bank_accounts?: Row }>(
    `/customer_bank_accounts/${encodeURIComponent(id)}`,
  );
  const account = json.customer_bank_accounts ?? {};
  const digits = str(account.account_number_ending)?.replace(/\D/g, '') ?? '';
  return {
    bank_name: str(account.bank_name)?.slice(0, 80) ?? null,
    account_number_ending: digits.length >= 2 ? digits.slice(-2) : null,
  };
}

// --- billing requests -------------------------------------------------------

async function directDebitSetUp(ctx: Ctx, billingRequest: Row): Promise<void> {
  const billingRequestId = str(billingRequest.id) as string;
  const metadata = isRecord(billingRequest.metadata) ? billingRequest.metadata : {};
  const links = isRecord(billingRequest.links) ? billingRequest.links : {};

  const { data: found, error: findError } = await ctx.admin
    .from('customer_direct_debits')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .eq('gocardless_billing_request_id', billingRequestId)
    .maybeSingle();
  if (findError) throw dbFail('Reading Direct Debit', findError);
  let row = (found as Row | null) ?? null;

  if (!row) {
    // The row written when the page was opened is missing — rebuild it from the metadata.
    const customerId = str(metadata.workwise_customer_id);
    if (!customerId || !UUID_RE.test(customerId)) return;
    const { data: customer } = await ctx.admin
      .from('customers')
      .select('id')
      .eq('id', customerId)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle();
    if (!customer) return;
    const organisation = ctx.organisationId;
    if (!organisation) return;
    const { data: inserted, error } = await ctx.admin
      .from('customer_direct_debits')
      .insert({
        tenant_id: ctx.tenantId,
        customer_id: customerId,
        gocardless_organisation_id: organisation,
        gocardless_billing_request_id: billingRequestId,
        source: 'workwise',
        status: 'setting_up',
      })
      .select('*')
      .single();
    if (error) {
      if (!isUniqueViolation(error)) throw dbFail('Creating Direct Debit', error);
      return;
    }
    row = inserted as Row;
  }
  if (row.status !== 'setting_up') return;

  const mandateId =
    str(links.mandate_request_mandate) ??
    str((billingRequest.mandate_request as Row | undefined)?.links && ((billingRequest.mandate_request as Row).links as Row).mandate);
  if (!mandateId) return;
  const mandateJson = await ctx.client.get<{ mandates?: GcMandate }>(`/mandates/${encodeURIComponent(mandateId)}`);
  const mandate = mandateJson.mandates;
  if (!mandate) return;
  const bank = await bankAccount(ctx, mandate);
  const customerId = String(row.customer_id);

  const status = mandate.status ?? '';
  const nextStatus =
    status === 'active'
      ? 'active'
      : ['failed', 'blocked', 'cancelled', 'expired'].includes(status)
        ? 'inactive'
        : 'pending';

  // Any other live Direct Debit for this customer is replaced by this one —
  // only when the new one is live, so a refused set-up never removes a working one.
  const { data: others, error: othersError } =
    nextStatus === 'inactive'
      ? { data: [], error: null }
      : await ctx.admin
          .from('customer_direct_debits')
          .select('id, gocardless_mandate_id')
          .eq('tenant_id', ctx.tenantId)
          .eq('customer_id', customerId)
          .in('status', ['pending', 'active']);
  if (othersError) throw dbFail('Reading Direct Debits', othersError);
  for (const other of (others ?? []) as Row[]) {
    if (other.id === row.id) continue;
    const oldMandate = str(other.gocardless_mandate_id);
    if (oldMandate) {
      try {
        await ctx.client.action(`/mandates/${encodeURIComponent(oldMandate)}/actions/cancel`);
      } catch (err) {
        if (isRevokedError(err)) throw err;
        console.error('[gc webhook] cancelling the old mandate', err instanceof GoCardlessError ? err.status : 'error');
      }
    }
    const result = await ctx.admin
      .from('customer_direct_debits')
      .update({ status: 'cancelled', cancelled_by: 'customer', cancelled_at: ctx.now.toISOString() })
      .eq('id', other.id as string)
      .in('status', ['pending', 'active'])
      .select('id');
    touched(result, 'Replacing old Direct Debit');
  }

  const update: Row = {
    gocardless_customer_id: str(links.customer) ?? str(mandate.links?.customer),
    gocardless_mandate_id: mandateId,
    bank_name: bank.bank_name,
    account_number_ending: bank.account_number_ending,
    mandate_reference: str(mandate.reference)?.slice(0, 40) ?? null,
    next_possible_charge_date: str(mandate.next_possible_charge_date),
    status: nextStatus,
  };
  if (nextStatus === 'active') update.activated_at = ctx.now.toISOString();
  if (nextStatus === 'inactive') update.inactive_reason = INACTIVE_REASONS[status] ?? null;

  const result = await ctx.admin
    .from('customer_direct_debits')
    .update(update)
    .eq('id', row.id as string)
    .eq('status', 'setting_up')
    .select('id');
  const changed = touched(result, 'Setting up Direct Debit');
  if (changed > 0 && nextStatus === 'active') {
    const name = await customerName(ctx, customerId);
    await push(ctx, 'dd_active', 'Direct Debit ready', `${name} is set up for Direct Debit`, {
      customerId,
      customerName: name,
    });
  }
}

async function handleBillingRequest(ctx: Ctx): Promise<void> {
  const { event } = ctx;
  if (event.action !== 'fulfilled') return;
  const id = str(event.links.billing_request);
  if (!id) return;
  const json = await ctx.client.get<{ billing_requests?: Row }>(`/billing_requests/${encodeURIComponent(id)}`);
  const billingRequest = json.billing_requests;
  if (!billingRequest) return;
  const metadata = isRecord(billingRequest.metadata) ? billingRequest.metadata : {};
  if (metadata.workwise_tenant_id !== ctx.tenantId) return;

  switch (metadata.workwise_kind) {
    case 'dd_setup':
      await directDebitSetUp(ctx, billingRequest);
      return;
    case 'pay_and_dd':
      await directDebitSetUp(ctx, billingRequest);
      await onPayRequestFulfilled(ctx.admin, ctx.tenantId, billingRequest as GcBillingRequest);
      return;
    case 'pay_by_bank':
      await onPayRequestFulfilled(ctx.admin, ctx.tenantId, billingRequest as GcBillingRequest);
      return;
    default:
      return;
  }
}

// --- mandates ---------------------------------------------------------------

async function handleMandate(ctx: Ctx): Promise<void> {
  const { event, admin, tenantId } = ctx;
  let mandateId = str(event.links.mandate);
  if (!mandateId) return;

  if (event.action === 'replaced') {
    const newMandate = str(event.links.new_mandate);
    if (newMandate) {
      const result = await admin
        .from('customer_direct_debits')
        .update({ gocardless_mandate_id: newMandate })
        .eq('tenant_id', tenantId)
        .eq('gocardless_mandate_id', mandateId)
        .select('id');
      touched(result, 'Replacing mandate');
      mandateId = newMandate;
    }
  }

  const json = await ctx.client.get<{ mandates?: GcMandate }>(`/mandates/${encodeURIComponent(mandateId)}`);
  const mandate = json.mandates;
  if (!mandate) return;
  const status = mandate.status ?? '';

  const row = await ddRowByMandate(ctx, mandateId);
  if (!row) {
    const result = await admin
      .from('gocardless_mandate_links')
      .update({ mandate_status: status })
      .eq('tenant_id', tenantId)
      .eq('gocardless_mandate_id', mandateId)
      .select('id');
    touched(result, 'Updating mandate link');
    return;
  }

  const rowId = row.id as string;
  const customerId = str(row.customer_id);
  const was = String(row.status);

  if (status === 'active') {
    if (was === 'pending' || was === 'inactive') {
      const result = await admin
        .from('customer_direct_debits')
        .update({
          status: 'active',
          activated_at: ctx.now.toISOString(),
          inactive_reason: null,
          next_possible_charge_date: str(mandate.next_possible_charge_date),
        })
        .eq('id', rowId)
        .in('status', ['pending', 'inactive'])
        .select('id');
      if (touched(result, 'Activating Direct Debit') > 0) {
        const name = await customerName(ctx, customerId);
        await push(ctx, 'dd_active', 'Direct Debit ready', `${name} is set up for Direct Debit`, {
          customerId: customerId ?? undefined,
          customerName: name,
        });
      }
    }
  } else if (['pending_submission', 'submitted', 'pending_customer_approval'].includes(status)) {
    if (was === 'setting_up' || was === 'inactive') {
      const result = await admin
        .from('customer_direct_debits')
        .update({ status: 'pending', inactive_reason: null })
        .eq('id', rowId)
        .in('status', ['setting_up', 'inactive'])
        .select('id');
      touched(result, 'Marking Direct Debit pending');
    }
  } else if (['failed', 'blocked', 'expired'].includes(status)) {
    if (['pending', 'setting_up', 'active'].includes(was)) {
      const reason = INACTIVE_REASONS[status];
      const result = await admin
        .from('customer_direct_debits')
        .update({ status: 'inactive', inactive_reason: reason })
        .eq('id', rowId)
        .in('status', ['pending', 'setting_up', 'active'])
        .select('id');
      if (touched(result, 'Marking Direct Debit inactive') > 0) {
        const name = await customerName(ctx, customerId);
        await push(
          ctx,
          'dd_cancelled',
          was === 'active' ? 'Direct Debit stopped' : 'Direct Debit not set up',
          `${name}: ${reason.toLowerCase()}`,
          { customerId: customerId ?? undefined, customerName: name },
        );
      }
    }
  } else if (status === 'cancelled') {
    if (was !== 'cancelled') {
      const cause = str(event.details?.cause);
      const cancelledBy =
        cause === 'bank_account_closed' || cause === 'invalid_bank_details'
          ? 'bank'
          : event.details?.origin === 'api'
            ? 'trader'
            : 'customer';
      const result = await admin
        .from('customer_direct_debits')
        .update({
          status: 'cancelled',
          cancelled_at: ctx.now.toISOString(),
          cancelled_by: cancelledBy,
        })
        .eq('id', rowId)
        .neq('status', 'cancelled')
        .select('id');
      if (touched(result, 'Cancelling Direct Debit') > 0 && cancelledBy !== 'trader') {
        const name = await customerName(ctx, customerId);
        await push(
          ctx,
          'dd_cancelled',
          'Direct Debit cancelled',
          cancelledBy === 'bank'
            ? `${name}'s Direct Debit stopped — their bank closed it`
            : `${name} cancelled their Direct Debit`,
          { customerId: customerId ?? undefined, customerName: name },
        );
      }
    }
  }

  if (event.action === 'transferred' && status !== 'cancelled') {
    const bank = await bankAccount(ctx, mandate);
    if (bank.bank_name || bank.account_number_ending) {
      const result = await admin
        .from('customer_direct_debits')
        .update(bank)
        .eq('id', rowId)
        .select('id');
      touched(result, 'Refreshing bank details');
    }
  }
}

// --- payments ---------------------------------------------------------------

async function payRequestFor(ctx: Ctx, paymentId: string): Promise<boolean> {
  const { data, error } = await ctx.admin
    .from('gocardless_pay_requests')
    .select('id')
    .eq('tenant_id', ctx.tenantId)
    .eq('gocardless_payment_id', paymentId)
    .maybeSingle();
  if (error) throw dbFail('Reading pay requests', error);
  return data != null;
}

/** One "another app is collecting" push per Direct Debit per London day, remembered on the event log. */
async function warnAnotherApp(ctx: Ctx, mandateId: string, customerId: string | null): Promise<void> {
  const { startIso } = londonDayBoundsUtc(todayInLondon(ctx.now));
  const { data, error } = await ctx.admin
    .from('gocardless_events')
    .select('id')
    .eq('tenant_id', ctx.tenantId)
    .eq('resource_type', 'payments')
    .eq('payload->>workwise_pushed', 'dd_attention')
    .eq('payload->>workwise_mandate', mandateId)
    .gte('received_at', startIso)
    .limit(1);
  if (error) throw dbFail('Checking earlier warnings', error);
  if (Array.isArray(data) && data.length > 0) return;

  const name = await customerName(ctx, customerId);
  await push(
    ctx,
    'dd_attention',
    'Another app is collecting',
    `Another app has asked GoCardless to collect from ${name}. Switch it off so they aren't charged twice — WorkWise won't collect from them while it's waiting.`,
    { customerId: customerId ?? undefined, customerName: name },
  );
  const result = await ctx.admin
    .from('gocardless_events')
    .update({ payload: { ...ctx.event, workwise_pushed: 'dd_attention', workwise_mandate: mandateId } })
    .eq('id', ctx.eventRowId)
    .select('id');
  touched(result, 'Remembering the warning');
}

async function paymentRow(ctx: Ctx, gcPaymentId: string): Promise<Row | null> {
  const { data, error } = await ctx.admin
    .from('payments')
    .select('id, amount, status, refunded_amount, dispute_status')
    .eq('tenant_id', ctx.tenantId)
    .eq('gocardless_payment_id', gcPaymentId)
    .maybeSingle();
  if (error) throw dbFail('Reading payment', error);
  return (data as Row | null) ?? null;
}

function refundedFrom(amount: number, payment: GcPayment): number {
  return Math.min(amount, fromPence(Number(payment.amount_refunded ?? 0)));
}

async function confirmCollection(ctx: Ctx, collection: Row, payment: GcPayment): Promise<void> {
  const { admin, tenantId, event, now } = ctx;
  const gcPaymentId = payment.id as string;
  const collectionId = collection.id as string;

  if (collection.status === 'succeeded' && collection.payment_id) {
    const result = await admin
      .from('direct_debit_collections')
      .update({ gocardless_status: payment.status })
      .eq('id', collectionId)
      .select('id');
    touched(result, 'Refreshing collection');
    return;
  }

  const amount = fromPence(Number(payment.amount));
  let paymentId: string | null = null;
  const inserted = await admin
    .from('payments')
    .insert({
      tenant_id: tenantId,
      customer_id: collection.customer_id,
      amount,
      method: 'direct_debit',
      source: 'gocardless',
      status: 'active',
      received_at: str(event.created_at) ?? now.toISOString(),
      gocardless_payment_id: gcPaymentId,
      refunded_amount: refundedFrom(amount, payment),
      recorded_by_user_id: null,
    })
    .select('id')
    .single();
  if (inserted.error) {
    if (!isUniqueViolation(inserted.error)) throw dbFail('Recording payment', inserted.error);
    paymentId = str((await paymentRow(ctx, gcPaymentId))?.id);
    if (!paymentId) throw new Error('Recording payment failed (duplicate, but not found)');
  } else {
    paymentId = str((inserted.data as Row | null)?.id);
    if (!paymentId) throw new Error('Recording payment failed (no id)');
  }

  // Also from failed / cancelled / error: the trader can retry a failed payment in
  // GoCardless and it can then be confirmed. The money arrived, so the collection
  // succeeded and any Collect again / Leave it choice no longer applies.
  const result = await admin
    .from('direct_debit_collections')
    .update({
      status: 'succeeded',
      payment_id: paymentId,
      finished_at: now.toISOString(),
      gocardless_status: payment.status,
      gocardless_payment_id: gcPaymentId,
      resolution: null,
      resolved_at: null,
      resolved_by_user_id: null,
    })
    .eq('id', collectionId)
    .neq('status', 'succeeded')
    .select('id');
  if (touched(result, 'Finishing collection') > 0) {
    const customerId = String(collection.customer_id);
    const name = await customerName(ctx, customerId);
    await push(ctx, 'dd_payment', 'Direct Debit received', `${formatGbp(amount)} from ${name}`, {
      amount,
      customerId,
      customerName: name,
    });
  }
}

const FAILURE_ACTIONS = ['failed', 'late_failure_settled'];

/**
 * Why a payment failed. GoCardless often sends `submitted` and `failed` together and
 * the `submitted` one can be handled first — it finds the payment already failed but
 * carries the wrong reason (`payment_submitted`). Only a failure event's own reason is
 * trusted; otherwise the real one is read from GoCardless. Never throws.
 */
async function failureDetails(ctx: Ctx, gcPaymentId: string): Promise<GcEvent['details']> {
  if (FAILURE_ACTIONS.includes(ctx.event.action)) return ctx.event.details;
  for (const action of FAILURE_ACTIONS) {
    try {
      const json = await ctx.client.get<{ events?: GcEvent[] }>('/events', {
        payment: gcPaymentId,
        resource_type: 'payments',
        action,
        limit: 1,
      });
      const details = json.events?.[0]?.details;
      if (details) return details;
    } catch (err) {
      if (err instanceof GoCardlessError) {
        console.error('[gocardless webhook] failure reason', { status: err.status, type: err.type, reasons: err.reasons });
      } else {
        console.error('[gocardless webhook] failure reason', err instanceof Error ? err.name : 'error');
      }
    }
  }
  return undefined;
}

async function failCollection(ctx: Ctx, collection: Row, gcPaymentId: string): Promise<void> {
  const { admin, now } = ctx;
  const collectionId = collection.id as string;
  const status = String(collection.status);
  if (status === 'failed') return;

  if (status === 'succeeded' && collection.payment_id) {
    const result = await admin
      .from('payments')
      .update({
        status: 'void',
        voided_at: now.toISOString(),
        void_reason: 'Direct Debit failed after collection',
      })
      .eq('id', collection.payment_id as string)
      .eq('status', 'active')
      .select('id');
    touched(result, 'Voiding payment');
  } else if (status !== 'creating' && status !== 'processing') {
    return;
  }

  const details = await failureDetails(ctx, gcPaymentId);
  const result = await admin
    .from('direct_debit_collections')
    .update({
      status: 'failed',
      failure_code: (str(details?.cause) ?? str(details?.reason_code))?.slice(0, 80) ?? null,
      failure_message: str(details?.description)?.slice(0, 300) ?? null,
      finished_at: now.toISOString(),
      gocardless_status: 'failed',
    })
    .eq('id', collectionId)
    .in('status', ['creating', 'processing', 'succeeded'])
    .select('id');
  if (touched(result, 'Failing collection') > 0) {
    await afterCollectionFailed(admin, collectionId);
  }
}

async function handlePayment(ctx: Ctx): Promise<void> {
  const { admin, tenantId, event, now } = ctx;
  const gcPaymentId = str(event.links.payment);
  if (!gcPaymentId) return;
  const json = await ctx.client.get<{ payments?: GcPayment }>(`/payments/${encodeURIComponent(gcPaymentId)}`);
  const payment = json.payments;
  if (!payment) return;
  const status = payment.status ?? '';

  if (await payRequestFor(ctx, gcPaymentId)) {
    await onPayRequestPayment(admin, tenantId, payment, event.created_at);
    return;
  }

  const claimed = str(payment.metadata?.workwise_collection_id);
  let collection: Row | null = null;
  if (claimed && UUID_RE.test(claimed)) {
    const { data, error } = await admin
      .from('direct_debit_collections')
      .select('*')
      .eq('id', claimed)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw dbFail('Reading collection', error);
    collection = (data as Row | null) ?? null;
  }

  if (!collection) {
    const mandateId = str(payment.links?.mandate);
    // A payment WorkWise didn't make, just created on a linked Direct Debit. The sandbox (and a slow
    // webhook) can have it paid out by now, so the event counts as well as the payment's current status.
    const newlyCreated = event.action === 'created' || event.action === 'submitted';
    if (mandateId && (newlyCreated || status === 'pending_submission' || status === 'submitted')) {
      const { data, error } = await admin
        .from('customer_direct_debits')
        .select('id, customer_id')
        .eq('tenant_id', tenantId)
        .eq('gocardless_mandate_id', mandateId)
        .eq('source', 'imported')
        .maybeSingle();
      if (error) throw dbFail('Reading Direct Debit', error);
      if (data) await warnAnotherApp(ctx, mandateId, str((data as Row).customer_id));
    }
    return;
  }

  const collectionId = collection.id as string;
  switch (status) {
    case 'pending_submission':
    case 'submitted': {
      if (collection.status !== 'creating' && collection.status !== 'processing') return;
      const update: Row = {
        gocardless_status: status,
        charge_date: str(payment.charge_date),
        gocardless_payment_id: str(collection.gocardless_payment_id) ?? gcPaymentId,
        submitted_at: str(collection.submitted_at) ?? now.toISOString(),
      };
      if (collection.status === 'creating') update.status = 'processing';
      const result = await admin
        .from('direct_debit_collections')
        .update(update)
        .eq('id', collectionId)
        .in('status', ['creating', 'processing'])
        .select('id');
      touched(result, 'Updating collection');
      return;
    }
    case 'confirmed':
    case 'paid_out':
      await confirmCollection(ctx, collection, payment);
      return;
    case 'failed':
      await failCollection(ctx, collection, gcPaymentId);
      return;
    case 'cancelled':
    case 'customer_approval_denied': {
      const result = await admin
        .from('direct_debit_collections')
        .update({
          status: 'cancelled',
          finished_at: now.toISOString(),
          gocardless_status: status,
        })
        .eq('id', collectionId)
        .in('status', ['creating', 'processing'])
        .select('id');
      touched(result, 'Cancelling collection');
      return;
    }
    case 'charged_back': {
      let row = await paymentRow(ctx, gcPaymentId);
      if (!row && (collection.status === 'creating' || collection.status === 'processing')) {
        // GoCardless (and the sandbox's Fickle) can confirm and reclaim in one go, so the
        // payment was never recorded. Record the money first so the reclaim has something to reverse.
        await confirmCollection(ctx, collection, payment);
        row = await paymentRow(ctx, gcPaymentId);
      }
      if (row && row.dispute_status !== 'lost') {
        const amount = Number(row.amount);
        const result = await admin
          .from('payments')
          .update({
            disputed_at: str(event.created_at) ?? now.toISOString(),
            dispute_status: 'lost',
            refunded_amount: amount,
          })
          .eq('id', row.id as string)
          .or('dispute_status.is.null,dispute_status.neq.lost')
          .select('id');
        if (touched(result, 'Recording chargeback') > 0) {
          const customerId = String(collection.customer_id);
          const name = await customerName(ctx, customerId);
          await push(
            ctx,
            'dd_failed',
            'Direct Debit reclaimed',
            `${name} reclaimed ${formatGbp(amount)} from their bank. It's owed again.`,
            { amount, customerId, customerName: name },
          );
        }
      }
      break;
    }
    case 'chargeback_cancelled': {
      const row = await paymentRow(ctx, gcPaymentId);
      if (row) {
        const result = await admin
          .from('payments')
          .update({
            dispute_status: 'won',
            refunded_amount: refundedFrom(Number(row.amount), payment),
          })
          .eq('id', row.id as string)
          .select('id');
        touched(result, 'Recording won chargeback');
      }
      break;
    }
    default:
      break;
  }

  if (collection.gocardless_status !== status) {
    const result = await admin
      .from('direct_debit_collections')
      .update({ gocardless_status: status })
      .eq('id', collectionId)
      .select('id');
    touched(result, 'Refreshing collection');
  }
}

// --- refunds, creditors, organisations --------------------------------------

async function handleRefund(ctx: Ctx): Promise<void> {
  const { event } = ctx;
  if (!['created', 'paid', 'failed'].includes(event.action)) return;
  const refundId = str(event.links.refund);
  if (!refundId) return;
  const refundJson = await ctx.client.get<{ refunds?: { links?: { payment?: string } } }>(
    `/refunds/${encodeURIComponent(refundId)}`,
  );
  const gcPaymentId = str(refundJson.refunds?.links?.payment);
  if (!gcPaymentId) return;
  const row = await paymentRow(ctx, gcPaymentId);
  if (!row) return;

  const json = await ctx.client.get<{ payments?: GcPayment }>(`/payments/${encodeURIComponent(gcPaymentId)}`);
  if (!json.payments) return;
  const amount = Number(row.amount);
  const refunded = refundedFrom(amount, json.payments);
  const current = Number(row.refunded_amount ?? 0);
  if (refunded === current) return;
  if (refunded < current && event.action !== 'failed') return;
  const result = await ctx.admin
    .from('payments')
    .update({ refunded_amount: refunded })
    .eq('id', row.id as string)
    .select('id');
  touched(result, 'Recording refund');
}

async function handleCreditor(ctx: Ctx): Promise<void> {
  const before = await getConnection(ctx.admin, ctx.tenantId);
  const after = await refreshVerification(ctx.admin, ctx.tenantId, { force: true, now: ctx.now });
  if (before?.verification_status === 'successful' && after?.verification_status === 'action_required') {
    await push(
      ctx,
      'dd_attention',
      'GoCardless needs more details',
      'Direct Debits are paused until you update your details with GoCardless (Settings → Payments).',
    );
  }
}

async function handleDisconnected(ctx: PushCtx): Promise<void> {
  const connection = await getConnection(ctx.admin, ctx.tenantId);
  // Already disconnected (by the trader in WorkWise, or earlier) — nothing to say.
  if (!connection || connection.status !== 'connected') return;
  await markDisconnected(ctx.admin, ctx.tenantId, 'GoCardless access was removed');
  await push(
    ctx,
    'dd_attention',
    'GoCardless disconnected',
    'Direct Debits have stopped. Reconnect GoCardless in Settings → Payments.',
  );
}

async function processOne(admin: SupabaseClient, row: Row, now: Date): Promise<void> {
  const event = row.payload as GcEvent;
  const tenantId = str(row.tenant_id);
  if (!tenantId || !isRecord(event)) return;
  const base = { admin, tenantId, event, eventRowId: String(row.id), organisationId: str(row.organisation_id), now };

  if (event.resource_type === 'organisations' && event.action === 'disconnected') {
    await handleDisconnected(base);
    return;
  }

  const unlocked = await clientForTenant(admin, tenantId);
  if (!unlocked) {
    // Only a business that really isn't connected is skipped. A read error or a
    // token that can't be unlocked must retry, or a confirmed collection is lost.
    if ((await connectionStatus(admin, tenantId)) === 'connected') {
      throw new Error('Could not open the GoCardless connection');
    }
    console.error('[gc webhook] no GoCardless connection for event', String(row.id));
    return;
  }
  const ctx: Ctx = {
    ...base,
    organisationId: str(unlocked.connection.organisation_id) ?? base.organisationId,
    client: unlocked.client,
  };

  try {
    switch (event.resource_type) {
      case 'billing_requests':
        await handleBillingRequest(ctx);
        break;
      case 'mandates':
        await handleMandate(ctx);
        break;
      case 'payments':
        await handlePayment(ctx);
        break;
      case 'refunds':
        await handleRefund(ctx);
        break;
      case 'creditors':
        await handleCreditor(ctx);
        break;
      default:
        break;
    }
  } catch (err) {
    if (isRevokedError(err)) {
      await markDisconnected(admin, tenantId, 'GoCardless access was removed');
      return;
    }
    throw err;
  }
}

/** GET the collection's GoCardless payment and apply the same payment handler as the webhook (idempotent). Never throws; returns what it did. */
export async function refreshCollection(
  admin: SupabaseClient,
  collectionId: string,
): Promise<'updated' | 'unchanged' | 'failed'> {
  const snapshot = async () => {
    const { data, error } = await admin
      .from('direct_debit_collections')
      .select('tenant_id, status, gocardless_status, gocardless_payment_id, payment_id')
      .eq('id', collectionId)
      .maybeSingle();
    if (error) throw dbFail('Reading collection', error);
    return (data as Row | null) ?? null;
  };
  const fingerprint = (row: Row | null) =>
    [row?.status, row?.gocardless_status, row?.payment_id].map((v) => String(v ?? '')).join('|');

  try {
    const before = await snapshot();
    const tenantId = str(before?.tenant_id);
    const gcPaymentId = str(before?.gocardless_payment_id);
    if (!before || !tenantId || !gcPaymentId) return 'unchanged';
    const beforePrint = fingerprint(before);

    const unlocked = await clientForTenant(admin, tenantId);
    if (!unlocked) return 'failed';
    const now = new Date();
    const ctx: Ctx = {
      admin,
      tenantId,
      client: unlocked.client,
      event: {
        id: null,
        created_at: now.toISOString(),
        resource_type: 'payments',
        action: 'refreshed',
        links: { payment: gcPaymentId },
      },
      eventRowId: '',
      organisationId: str(unlocked.connection.organisation_id),
      now,
    };
    try {
      await handlePayment(ctx);
    } catch (err) {
      if (isRevokedError(err)) {
        await markDisconnected(admin, tenantId, 'GoCardless access was removed');
        return 'failed';
      }
      throw err;
    }
    return fingerprint(await snapshot()) === beforePrint ? 'unchanged' : 'updated';
  } catch (err) {
    console.error('[gc webhook] refreshCollection', collectionId, errorText(err));
    return 'failed';
  }
}

function errorText(err: unknown): string {
  if (err instanceof GoCardlessError) {
    return `GoCardless ${err.status}${err.reasons.length ? ` ${err.reasons.join(',')}` : ''}: ${err.message}`;
  }
  return err instanceof Error ? err.message : 'error';
}

/** Processes stored events: the given ids, or (sweep) every unprocessed one older than olderThanMs (default 2 min), oldest first, max `limit` (default 200).
 *  Per event: attempts + 1; success → processed_at; error → last_error (≤500), stays unprocessed; attempts ≥ 10 → processed_at set with last_error 'gave up: …'. Never throws. */
export async function processGoCardlessEvents(
  admin: SupabaseClient,
  p: { ids?: string[]; olderThanMs?: number; limit?: number; now?: Date },
): Promise<{ processed: number; failed: number }> {
  const now = p.now ?? new Date();
  const result = { processed: 0, failed: 0 };
  try {
    let query = admin
      .from('gocardless_events')
      .select('id, tenant_id, organisation_id, payload, attempts')
      .is('processed_at', null);
    if (p.ids) {
      if (p.ids.length === 0) return result;
      query = query.in('id', p.ids);
    } else {
      const cutoff = new Date(now.getTime() - (p.olderThanMs ?? DEFAULT_OLDER_THAN_MS)).toISOString();
      query = query.lte('received_at', cutoff);
    }
    const { data, error } = await query.order('received_at', { ascending: true }).limit(p.limit ?? DEFAULT_LIMIT);
    if (error) {
      console.error('[gc webhook] reading events failed', error.code);
      return result;
    }

    for (const row of (data ?? []) as Row[]) {
      const attempts = Number(row.attempts ?? 0) + 1;
      try {
        await processOne(admin, row, now);
        await admin
          .from('gocardless_events')
          .update({ attempts, processed_at: now.toISOString(), last_error: null })
          .eq('id', row.id as string);
        result.processed += 1;
      } catch (err) {
        const text = errorText(err);
        console.error('[gc webhook] event failed', String(row.id), text);
        const giveUp = attempts >= MAX_ATTEMPTS;
        await admin
          .from('gocardless_events')
          .update({
            attempts,
            last_error: (giveUp ? `gave up: ${text}` : text).slice(0, 500),
            ...(giveUp ? { processed_at: now.toISOString() } : {}),
          })
          .eq('id', row.id as string);
        result.failed += 1;
      }
    }
  } catch (err) {
    console.error('[gc webhook] processing failed', err instanceof Error ? err.message : 'error');
  }
  return result;
}
