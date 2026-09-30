import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { otherAppCollections } from '@/lib/direct-debit/existing';
import { getDirectDebitState } from '@/lib/direct-debit/state';
import {
  GoCardlessError,
  isRevokedError,
  type GoCardlessClient,
} from '@/lib/gocardless/client';
import { clientForTenant, markDisconnected } from '@/lib/gocardless/connection';
import { fromPence, roundMoney, toPence } from '@/lib/money/pence';

export const DD_MIN_COLLECTION = 1; // £
export const DD_MAX_COLLECTION = 1000; // £

export type CollectOutcome =
  | { kind: 'created'; collectionId: string; amount: number }
  | { kind: 'skipped'; reason: 'no_direct_debit' | 'not_available' | 'nothing_to_collect' | 'busy' }
  | { kind: 'other_app'; detail: string }
  | { kind: 'too_large'; amount: number }
  | { kind: 'error'; collectionId: string | null; message: string };

export type CollectionNumbers = {
  owed: number;
  collecting: number;
  /** Failed collections the trader hasn't decided about yet (D6). */
  heldFailed: number;
  payingByBank: number;
  /**
   * Failed collections the trader chose to Leave: never collected by Direct
   * Debit again (the chasers ask for it instead). Released as the customer
   * pays some other way after the failure.
   */
  left: number;
};

const UNUSABLE_MANDATE = new Set(['mandate_is_inactive', 'mandate_expired', 'mandate_cancelled']);
const RESUME_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type Row = Record<string, unknown>;
type GcPayment = { id?: string; status?: string; charge_date?: string };

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function sum(values: number[]): number {
  return fromPence(values.reduce((total, v) => total + toPence(v), 0));
}

/** Pure: owed − collecting − heldFailed − payingByBank (− left), rounded to pence, never negative. */
export function amountToCollect(p: {
  owed: number;
  collecting: number;
  heldFailed: number;
  payingByBank: number;
  left?: number;
}): number {
  const pence =
    toPence(p.owed) -
    toPence(p.collecting) -
    toPence(p.heldFailed) -
    toPence(p.payingByBank) -
    toPence(p.left ?? 0);
  return pence <= 0 ? 0 : fromPence(pence);
}

/**
 * Reads customer_balances.owed_amount, the customer's collections and their
 * gocardless_pay_requests in 'fulfilled'. Throws on a database error: when we
 * can't count, we don't collect.
 */
export async function loadCollectionNumbers(
  admin: SupabaseClient,
  tenantId: string,
  customerId: string,
  opts: { excludeCollectionId?: string } = {},
): Promise<CollectionNumbers> {
  const [balance, collections, payRequests] = await Promise.all([
    admin
      .from('customer_balances')
      .select('owed_amount')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .maybeSingle(),
    admin
      .from('direct_debit_collections')
      .select('id, amount, status, resolution, created_at')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .in('status', ['creating', 'processing', 'failed']),
    admin
      .from('gocardless_pay_requests')
      .select('amount')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .eq('status', 'fulfilled'),
  ]);
  if (balance.error) throw new Error(`Reading balance failed (${balance.error.code ?? 'db'})`);
  if (collections.error) throw new Error(`Reading collections failed (${collections.error.code ?? 'db'})`);
  if (payRequests.error) throw new Error(`Reading pay requests failed (${payRequests.error.code ?? 'db'})`);

  const rows = ((collections.data ?? []) as Row[]).filter((r) => r.id !== opts.excludeCollectionId);
  const collecting = sum(
    rows.filter((r) => r.status === 'creating' || r.status === 'processing').map((r) => num(r.amount)),
  );
  const heldFailed = sum(
    rows.filter((r) => r.status === 'failed' && r.resolution == null).map((r) => num(r.amount)),
  );

  const leftRows = rows.filter((r) => r.status === 'failed' && r.resolution === 'left');
  let left = 0;
  if (leftRows.length > 0) {
    const since = leftRows
      .map((r) => str(r.created_at))
      .filter((d): d is string => d != null)
      .sort()[0];
    // Money the customer paid some other way since the failure pays the left amount first.
    const { data: paid, error: paidError } = await admin
      .from('payments')
      .select('amount, refunded_amount, method')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .eq('status', 'active')
      .neq('method', 'direct_debit')
      .gte('received_at', since ?? '1970-01-01T00:00:00Z');
    if (paidError) throw new Error(`Reading payments failed (${paidError.code ?? 'db'})`);
    const paidOtherWays = sum(
      ((paid ?? []) as Row[]).map((r) => Math.max(0, num(r.amount) - num(r.refunded_amount))),
    );
    left = Math.max(0, fromPence(toPence(sum(leftRows.map((r) => num(r.amount)))) - toPence(paidOtherWays)));
  }

  return {
    owed: roundMoney(num((balance.data as Row | null)?.owed_amount)),
    collecting,
    heldFailed,
    payingByBank: sum(((payRequests.data ?? []) as Row[]).map((r) => num(r.amount))),
    left,
  };
}

function targetFrom(numbers: CollectionNumbers, traderAmount: number | undefined): number {
  if (traderAmount === undefined) return amountToCollect(numbers);
  const room = amountToCollect({
    owed: numbers.owed,
    collecting: numbers.collecting,
    heldFailed: 0,
    payingByBank: numbers.payingByBank,
  });
  return Math.max(0, Math.min(roundMoney(traderAmount), room));
}

async function businessName(admin: SupabaseClient, tenantId: string): Promise<string> {
  const { data } = await admin.from('tenants').select('name').eq('id', tenantId).maybeSingle();
  return (str((data as Row | null)?.name) ?? 'WorkWise').slice(0, 100);
}

function logProvider(label: string, err: unknown): void {
  if (err instanceof GoCardlessError) {
    console.error(label, { status: err.status, type: err.type, reasons: err.reasons, requestId: err.requestId });
  } else {
    console.error(label, err instanceof Error ? err.message : 'error');
  }
}

/** Steps 7–11: the create call (same key every time) and what its answer means. */
async function sendToGoCardless(
  admin: SupabaseClient,
  client: GoCardlessClient,
  p: {
    tenantId: string;
    customerId: string;
    collectionId: string;
    directDebitId: string;
    mandateId: string;
    amount: number;
    now: Date;
  },
): Promise<CollectOutcome> {
  let payment: GcPayment | null = null;
  try {
    // 7.
    const json = await client.post<{ payments?: GcPayment }>(
      '/payments',
      {
        payments: {
          amount: toPence(p.amount),
          currency: 'GBP',
          description: await businessName(admin, p.tenantId),
          retry_if_possible: false,
          metadata: {
            workwise_tenant_id: p.tenantId,
            workwise_customer_id: p.customerId,
            workwise_collection_id: p.collectionId,
          },
          links: { mandate: p.mandateId },
        },
      },
      { idempotencyKey: `ddc_${p.collectionId}` },
    );
    payment = json.payments ?? null;
  } catch (err) {
    // 9. Already created by an earlier attempt with this key.
    if (err instanceof GoCardlessError && err.status === 409 && err.conflictingResourceId) {
      try {
        const json = await client.get<{ payments?: GcPayment }>(
          `/payments/${encodeURIComponent(err.conflictingResourceId)}`,
        );
        payment = json.payments ?? null;
      } catch (readErr) {
        logProvider('[direct-debit] collect: reading the existing payment', readErr);
        return { kind: 'error', collectionId: p.collectionId, message: 'Could not reach GoCardless.' };
      }
    } else {
      return failedCreate(admin, err, p);
    }
  }

  const gcPaymentId = str(payment?.id);
  if (!payment || !gcPaymentId) {
    // Leave it `creating`: the sweep asks again with the same key.
    return { kind: 'error', collectionId: p.collectionId, message: 'GoCardless gave no payment.' };
  }

  // 8. The webhook may have got here first — only `creating` rows move.
  const { error } = await admin
    .from('direct_debit_collections')
    .update({
      gocardless_payment_id: gcPaymentId,
      gocardless_status: str(payment.status),
      charge_date: str(payment.charge_date),
      status: 'processing',
      submitted_at: p.now.toISOString(),
    })
    .eq('id', p.collectionId)
    .eq('status', 'creating');
  if (error) {
    // The payment exists at GoCardless; the webhook (step 11) moves the row on.
    console.error('[direct-debit] collect: marking processing', error.code);
  }
  return { kind: 'created', collectionId: p.collectionId, amount: p.amount };
}

/** Steps 10–11. */
async function failedCreate(
  admin: SupabaseClient,
  err: unknown,
  p: { tenantId: string; collectionId: string; directDebitId: string },
): Promise<CollectOutcome> {
  logProvider('[direct-debit] collect', err);
  const markError = async (code: string | null, message: string) => {
    await admin
      .from('direct_debit_collections')
      .update({
        status: 'error',
        failure_code: code?.slice(0, 80) ?? null,
        failure_message: message.slice(0, 300),
        finished_at: new Date().toISOString(),
      })
      .eq('id', p.collectionId)
      .eq('status', 'creating');
  };

  if (isRevokedError(err)) {
    await markDisconnected(admin, p.tenantId, 'GoCardless access was removed');
    await markError('access_token_revoked', 'GoCardless access was removed');
    return { kind: 'error', collectionId: p.collectionId, message: 'GoCardless access was removed.' };
  }

  // 11. Network, timeout, 5xx, or 429 after the client's own retry → try again later with the same key.
  if (!(err instanceof GoCardlessError) || err.status === 0 || err.status === 429 || err.status >= 500) {
    return { kind: 'error', collectionId: p.collectionId, message: 'Could not reach GoCardless.' };
  }

  // 10. GoCardless refused it: nothing was taken.
  const reason = err.reasons[0] ?? err.type ?? null;
  await markError(reason, err.message || 'GoCardless refused the collection');
  if (err.reasons.some((r) => UNUSABLE_MANDATE.has(r))) {
    await admin
      .from('customer_direct_debits')
      .update({ status: 'inactive', inactive_reason: 'GoCardless says this Direct Debit is no longer active' })
      .eq('id', p.directDebitId)
      .in('status', ['pending', 'active']);
  }
  return { kind: 'error', collectionId: p.collectionId, message: err.message || 'GoCardless refused the collection.' };
}

/**
 * amount: omit to collect what's owed now (T6); pass a number for Collect
 * again (step 14), still capped by what's owed now minus what's collecting.
 */
export async function collectForCustomer(
  admin: SupabaseClient,
  p: {
    tenantId: string;
    customerId: string;
    createdBy: 'cron' | 'trader';
    userId?: string | null;
    amount?: number;
    now?: Date;
  },
): Promise<CollectOutcome> {
  const now = p.now ?? new Date();

  // 1.
  if ((await getDirectDebitState(admin, p.tenantId)) !== 'on') {
    return { kind: 'skipped', reason: 'not_available' };
  }
  const unlocked = await clientForTenant(admin, p.tenantId);
  if (!unlocked) return { kind: 'skipped', reason: 'not_available' };

  // 2.
  const { data: ddData, error: ddError } = await admin
    .from('customer_direct_debits')
    .select('id, source, gocardless_mandate_id, status')
    .eq('tenant_id', p.tenantId)
    .eq('customer_id', p.customerId)
    .in('status', ['pending', 'active'])
    .maybeSingle();
  if (ddError) {
    return { kind: 'error', collectionId: null, message: `Reading Direct Debit failed (${ddError.code ?? 'db'})` };
  }
  const dd = ddData as Row | null;
  const mandateId = str(dd?.gocardless_mandate_id);
  if (!dd || !mandateId) return { kind: 'skipped', reason: 'no_direct_debit' };
  const directDebitId = String(dd.id);

  // 3.
  let target: number;
  try {
    target = targetFrom(await loadCollectionNumbers(admin, p.tenantId, p.customerId), p.amount);
  } catch (err) {
    return { kind: 'error', collectionId: null, message: err instanceof Error ? err.message : 'error' };
  }
  if (target < DD_MIN_COLLECTION) return { kind: 'skipped', reason: 'nothing_to_collect' };
  if (target > DD_MAX_COLLECTION) return { kind: 'too_large', amount: target };

  // 4. Old-app guard (D22b) — fail safe.
  if (dd.source === 'imported') {
    const other = await otherAppCollections(admin, { tenantId: p.tenantId, mandateId });
    if ('error' in other) return { kind: 'error', collectionId: null, message: other.error };
    if (other.count > 0) return { kind: 'other_app', detail: other.detail };
  }

  // 5. Claim.
  const { data: claimed, error: claimError } = await admin
    .from('direct_debit_collections')
    .insert({
      tenant_id: p.tenantId,
      customer_id: p.customerId,
      direct_debit_id: directDebitId,
      amount: target,
      status: 'creating',
      created_by: p.createdBy,
      created_by_user_id: p.userId ?? null,
    })
    .select('id')
    .single();
  if (claimError) {
    if (claimError.code === '23505') return { kind: 'skipped', reason: 'busy' };
    return { kind: 'error', collectionId: null, message: `Claiming the collection failed (${claimError.code ?? 'db'})` };
  }
  const collectionId = String((claimed as Row).id);

  // 6. Re-check after claiming.
  let recheck: number;
  try {
    recheck = targetFrom(
      await loadCollectionNumbers(admin, p.tenantId, p.customerId, { excludeCollectionId: collectionId }),
      p.amount,
    );
  } catch (err) {
    await admin.from('direct_debit_collections').delete().eq('id', collectionId).eq('status', 'creating');
    return { kind: 'error', collectionId: null, message: err instanceof Error ? err.message : 'error' };
  }
  if (recheck < DD_MIN_COLLECTION || recheck > DD_MAX_COLLECTION) {
    await admin.from('direct_debit_collections').delete().eq('id', collectionId).eq('status', 'creating');
    return recheck < DD_MIN_COLLECTION
      ? { kind: 'skipped', reason: 'nothing_to_collect' }
      : { kind: 'too_large', amount: recheck };
  }
  if (recheck !== target) {
    const { error } = await admin
      .from('direct_debit_collections')
      .update({ amount: recheck })
      .eq('id', collectionId)
      .eq('status', 'creating');
    if (error) {
      await admin.from('direct_debit_collections').delete().eq('id', collectionId).eq('status', 'creating');
      return { kind: 'error', collectionId: null, message: `Updating the collection failed (${error.code ?? 'db'})` };
    }
    target = recheck;
  }

  // 7–11.
  return sendToGoCardless(admin, unlocked.client, {
    tenantId: p.tenantId,
    customerId: p.customerId,
    collectionId,
    directDebitId,
    mandateId,
    amount: target,
    now,
  });
}

/** For the morning sweep (step 13): re-send the create call for a collection stuck in 'creating' (same idempotency key). */
export async function resumeCollection(
  admin: SupabaseClient,
  collectionId: string,
  now: Date = new Date(),
): Promise<CollectOutcome> {
  const { data, error } = await admin
    .from('direct_debit_collections')
    .select('id, tenant_id, customer_id, direct_debit_id, amount, status, created_at')
    .eq('id', collectionId)
    .maybeSingle();
  if (error) {
    return { kind: 'error', collectionId, message: `Reading the collection failed (${error.code ?? 'db'})` };
  }
  const row = data as Row | null;
  if (!row || row.status !== 'creating') return { kind: 'skipped', reason: 'nothing_to_collect' };
  const tenantId = String(row.tenant_id);

  const createdAt = Date.parse(String(row.created_at));
  if (!Number.isFinite(createdAt) || now.getTime() - createdAt > RESUME_MAX_AGE_MS) {
    await admin
      .from('direct_debit_collections')
      .update({ status: 'error', failure_message: 'Never reached GoCardless', finished_at: now.toISOString() })
      .eq('id', collectionId)
      .eq('status', 'creating');
    return { kind: 'error', collectionId, message: 'Never reached GoCardless' };
  }

  const unlocked = await clientForTenant(admin, tenantId);
  if (!unlocked) return { kind: 'skipped', reason: 'not_available' };

  const { data: ddData } = await admin
    .from('customer_direct_debits')
    .select('id, gocardless_mandate_id')
    .eq('id', String(row.direct_debit_id))
    .eq('tenant_id', tenantId)
    .maybeSingle();
  const mandateId = str((ddData as Row | null)?.gocardless_mandate_id);
  if (!mandateId) return { kind: 'skipped', reason: 'no_direct_debit' };

  return sendToGoCardless(admin, unlocked.client, {
    tenantId,
    customerId: String(row.customer_id),
    collectionId,
    directDebitId: String(row.direct_debit_id),
    mandateId,
    amount: num(row.amount),
    now,
  });
}
