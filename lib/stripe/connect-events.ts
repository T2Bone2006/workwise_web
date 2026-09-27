import 'server-only';

import type Stripe from 'stripe';
import { formatGbp, fromPence } from '@/lib/money/pence';
import { getSoloWorkerForTenant } from '@/lib/rounds/rounds-worker';
import { sendExpoPushMessages } from '@/lib/services/expo-push';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripe } from '@/lib/stripe/client';
import { syncConnectMirror, tenantIdForAccount } from '@/lib/stripe/connect';

export const CONNECT_EVENTS = [
  'account.updated',
  'account.application.deauthorized',
  'checkout.session.completed',
  'charge.refunded',
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.dispute.closed',
] as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PaymentRow = {
  tenant_id: string;
  customer_id: string;
  amount: number;
  method: 'card';
  source: 'stripe';
  status: 'active';
  received_at: string;
  stripe_payment_intent_id: string;
  stripe_checkout_session_id: string;
  invoice_id: string | null;
  note: string;
};

function meta(session: Stripe.Checkout.Session, key: string): string {
  const value = session.metadata?.[key];
  return typeof value === 'string' ? value : '';
}

function paymentIntentId(
  ref: string | { id: string } | null | undefined,
): string {
  if (!ref) return '';
  return typeof ref === 'string' ? ref : ref.id;
}

function invoiceIdFromMetadata(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '' || !UUID_RE.test(trimmed)) return null;
  return trimmed;
}

export function paymentRowFromCheckoutSession(
  session: Stripe.Checkout.Session,
  tenantId: string,
  eventCreated: number,
):
  | { ok: true; row: PaymentRow }
  | {
      ok: false;
      reason: 'not_ours' | 'not_paid' | 'wrong_currency' | 'tenant_mismatch' | 'missing_customer';
    } {
  if (meta(session, 'workwise_kind') !== 'pay_link') {
    return { ok: false, reason: 'not_ours' };
  }
  if (session.payment_status !== 'paid') {
    return { ok: false, reason: 'not_paid' };
  }
  if (session.currency !== 'gbp') {
    return { ok: false, reason: 'wrong_currency' };
  }
  if (meta(session, 'workwise_tenant_id') !== tenantId) {
    return { ok: false, reason: 'tenant_mismatch' };
  }
  const customerId = meta(session, 'customer_id').trim();
  if (customerId === '') {
    return { ok: false, reason: 'missing_customer' };
  }

  return {
    ok: true,
    row: {
      tenant_id: tenantId,
      customer_id: customerId,
      amount: fromPence(session.amount_total ?? 0),
      method: 'card',
      source: 'stripe',
      status: 'active',
      received_at: new Date(eventCreated * 1000).toISOString(),
      stripe_payment_intent_id: paymentIntentId(session.payment_intent),
      stripe_checkout_session_id: session.id,
      invoice_id: invoiceIdFromMetadata(meta(session, 'invoice_id')),
      note: 'Card payment',
    },
  };
}

export function refundedAmountFromCharge(
  charge: Pick<Stripe.Charge, 'amount' | 'amount_refunded'>,
  paymentAmount: number,
): number {
  return Math.min(paymentAmount, fromPence(charge.amount_refunded));
}

type StoredPayment = {
  id: string;
  amount: number;
  customer_id: string;
};

async function paymentForIntent(
  tenantId: string,
  paymentIntent: string | { id: string } | null,
): Promise<StoredPayment> {
  const found = await findPaymentForIntent(tenantId, paymentIntent);
  if (!found) {
    const intentId = paymentIntentId(paymentIntent);
    throw new Error(
      intentId === ''
        ? 'Charge has no payment_intent'
        : `No payment for payment_intent ${intentId}`,
    );
  }
  return found;
}

/** Like paymentForIntent, but null when the checkout row isn't there yet (race). */
async function findPaymentForIntent(
  tenantId: string,
  paymentIntent: string | { id: string } | null,
): Promise<StoredPayment | null> {
  const intentId = paymentIntentId(paymentIntent);
  if (intentId === '') return null;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('payments')
    .select('id, amount, customer_id')
    .eq('tenant_id', tenantId)
    .eq('stripe_payment_intent_id', intentId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as { id: string; amount: number | string; customer_id: string };
  return {
    id: row.id,
    amount: Number(row.amount),
    customer_id: row.customer_id,
  };
}

function disputePatchFromCharge(charge: Stripe.Charge): {
  disputed_at: string;
  dispute_status: string;
} | null {
  if (!charge.disputed) return null;
  const disputeRef = (charge as Stripe.Charge & { dispute?: Stripe.Dispute | string | null })
    .dispute;
  if (disputeRef && typeof disputeRef !== 'string') {
    return {
      disputed_at: new Date(disputeRef.created * 1000).toISOString(),
      dispute_status: disputeRef.status,
    };
  }
  return {
    disputed_at: new Date().toISOString(),
    dispute_status: 'needs_response',
  };
}

/**
 * Dispute/refund webhooks can arrive before checkout.session.completed records
 * the payment (test dispute cards especially). After insert, pull the charge
 * and apply any refund/dispute already on it.
 */
async function syncPaymentFromLatestCharge(p: {
  tenantId: string;
  accountId: string;
  paymentId: string;
  paymentAmount: number;
  paymentIntentId: string;
}): Promise<{ disputed: boolean }> {
  if (p.paymentIntentId === '') return { disputed: false };

  const intent = await getStripe().paymentIntents.retrieve(
    p.paymentIntentId,
    { expand: ['latest_charge.dispute'] },
    { stripeAccount: p.accountId },
  );
  const charge = intent.latest_charge;
  if (!charge || typeof charge === 'string') {
    // Charge id only — fetch full object with dispute expanded.
    if (typeof charge === 'string' && charge !== '') {
      return syncPaymentFromCharge({
        tenantId: p.tenantId,
        accountId: p.accountId,
        paymentId: p.paymentId,
        paymentAmount: p.paymentAmount,
        chargeId: charge,
      });
    }
    return { disputed: false };
  }
  return applyChargeStateToPayment({
    tenantId: p.tenantId,
    paymentId: p.paymentId,
    paymentAmount: p.paymentAmount,
    charge,
  });
}

async function syncPaymentFromCharge(p: {
  tenantId: string;
  accountId: string;
  paymentId: string;
  paymentAmount: number;
  chargeId: string;
}): Promise<{ disputed: boolean }> {
  const charge = await getStripe().charges.retrieve(
    p.chargeId,
    { expand: ['dispute'] },
    { stripeAccount: p.accountId },
  );
  return applyChargeStateToPayment({
    tenantId: p.tenantId,
    paymentId: p.paymentId,
    paymentAmount: p.paymentAmount,
    charge,
  });
}

async function applyChargeStateToPayment(p: {
  tenantId: string;
  paymentId: string;
  paymentAmount: number;
  charge: Stripe.Charge;
}): Promise<{ disputed: boolean }> {
  const patch: Record<string, unknown> = {
    stripe_charge_id: p.charge.id,
  };
  if (p.charge.amount_refunded > 0) {
    patch.refunded_amount = refundedAmountFromCharge(p.charge, p.paymentAmount);
  }
  const dispute = disputePatchFromCharge(p.charge);
  if (dispute) {
    patch.disputed_at = dispute.disputed_at;
    patch.dispute_status = dispute.dispute_status;
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from('payments')
    .update(patch)
    .eq('id', p.paymentId)
    .eq('tenant_id', p.tenantId);
  if (error) {
    console.error('[connect-events] sync charge state', error);
    throw error;
  }
  return { disputed: Boolean(dispute) };
}

async function customerName(tenantId: string, customerId: string): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('customers')
    .select('name')
    .eq('id', customerId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  const name = (data as { name?: string } | null)?.name?.trim();
  return name && name !== '' ? name : 'a customer';
}

async function pushSoloWorker(tenantId: string, title: string, body: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const worker = await getSoloWorkerForTenant(admin, tenantId);
    const token = worker?.expo_push_token?.trim() ?? '';
    if (!token) return;
    await sendExpoPushMessages([{ to: token, title, body, sound: 'default' }]);
  } catch (err) {
    console.error('[connect-events] push failed', err);
  }
}

async function invoiceBelongsToTenant(tenantId: string, invoiceId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('invoices')
    .select('id')
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function customerBelongsToTenant(tenantId: string, customerId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('customers')
    .select('id')
    .eq('id', customerId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

/** Throws on anything that should make Stripe retry. Returns normally when the event is handled or deliberately ignored. */
export async function handleConnectEvent(event: Stripe.Event): Promise<void> {
  if (!event.account) {
    console.warn('[connect-events] event has no account', event.id, event.type);
    return;
  }

  const tenantId = await tenantIdForAccount(event.account);
  if (!tenantId) {
    console.warn('[connect-events] unknown connected account', event.account, event.type);
    return;
  }

  switch (event.type) {
    case 'account.updated': {
      const account = event.data.object as Stripe.Account;
      if (account.metadata?.workwise_tenant_id !== tenantId) {
        console.error('[connect-events] account.updated tenant mismatch', {
          tenantId,
          accountId: account.id,
          metadataTenantId: account.metadata?.workwise_tenant_id,
        });
        return;
      }
      await syncConnectMirror({ tenantId, account });
      return;
    }
    case 'account.application.deauthorized': {
      await syncConnectMirror({
        tenantId,
        account: {
          charges_enabled: false,
          payouts_enabled: false,
          details_submitted: false,
          requirements: {
            currently_due: [],
            past_due: [],
            disabled_reason: 'deauthorized',
          },
        } as unknown as Stripe.Account,
      });
      return;
    }
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const parsed = paymentRowFromCheckoutSession(session, tenantId, event.created);
      if (!parsed.ok) {
        console.warn('[connect-events] checkout ignored', parsed.reason, session.id);
        return;
      }
      if (parsed.row.stripe_payment_intent_id === '') {
        throw new Error(`Checkout session ${session.id} has no payment_intent`);
      }
      if (!(await customerBelongsToTenant(tenantId, parsed.row.customer_id))) {
        console.error('[connect-events] customer does not belong to tenant', {
          tenantId,
          customerId: parsed.row.customer_id,
          sessionId: session.id,
        });
        return;
      }
      let invoiceId = parsed.row.invoice_id;
      if (invoiceId && !(await invoiceBelongsToTenant(tenantId, invoiceId))) {
        console.warn('[connect-events] invoice ignored', invoiceId, tenantId);
        invoiceId = null;
      }
      const admin = createAdminClient();
      const { data: inserted, error } = await admin
        .from('payments')
        .insert({
          ...parsed.row,
          invoice_id: invoiceId,
        })
        .select('id')
        .maybeSingle();
      if (isUniqueViolation(error)) {
        // Payment already recorded — still sync dispute/refund that may have
        // arrived first (dispute test cards).
        const existing = await paymentForIntent(
          tenantId,
          parsed.row.stripe_payment_intent_id,
        ).catch(() => null);
        if (existing && event.account) {
          await syncPaymentFromLatestCharge({
            tenantId,
            accountId: event.account,
            paymentId: existing.id,
            paymentAmount: existing.amount,
            paymentIntentId: parsed.row.stripe_payment_intent_id,
          });
        }
        return;
      }
      if (error) throw error;
      const paymentId =
        inserted && typeof (inserted as { id?: unknown }).id === 'string'
          ? (inserted as { id: string }).id
          : null;
      if (paymentId && event.account) {
        const synced = await syncPaymentFromLatestCharge({
          tenantId,
          accountId: event.account,
          paymentId,
          paymentAmount: parsed.row.amount,
          paymentIntentId: parsed.row.stripe_payment_intent_id,
        });
        if (synced.disputed) {
          await pushSoloWorker(
            tenantId,
            'Card payment disputed',
            `A customer disputed a ${formatGbp(parsed.row.amount)} card payment. Open Stripe to respond — you have a deadline.`,
          );
        }
      }
      const name = await customerName(tenantId, parsed.row.customer_id);
      await pushSoloWorker(
        tenantId,
        'Card payment received',
        `${formatGbp(parsed.row.amount)} from ${name}`,
      );
      return;
    }
    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge;
      const payment = await findPaymentForIntent(tenantId, charge.payment_intent);
      if (!payment) {
        // Checkout may still be in flight — throw so Stripe retries.
        throw new Error(
          `No payment for payment_intent ${paymentIntentId(charge.payment_intent)}`,
        );
      }
      const admin = createAdminClient();
      const { error } = await admin
        .from('payments')
        .update({
          refunded_amount: refundedAmountFromCharge(charge, payment.amount),
          stripe_charge_id: charge.id,
        })
        .eq('id', payment.id)
        .eq('tenant_id', tenantId);
      if (error) throw error;
      return;
    }
    case 'charge.dispute.created': {
      const dispute = event.data.object as Stripe.Dispute;
      const payment = await findPaymentForIntent(tenantId, dispute.payment_intent);
      if (!payment) {
        // Dispute test cards fire this before checkout.session.completed.
        // Ack so we don't 500; checkout sync copies dispute onto the new row.
        console.warn(
          '[connect-events] dispute before payment row; checkout will sync',
          paymentIntentId(dispute.payment_intent),
          event.id,
        );
        return;
      }
      const admin = createAdminClient();
      const { error } = await admin
        .from('payments')
        .update({
          disputed_at: new Date(dispute.created * 1000).toISOString(),
          dispute_status: dispute.status,
          stripe_charge_id:
            typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id ?? null,
        })
        .eq('id', payment.id)
        .eq('tenant_id', tenantId);
      if (error) throw error;
      await pushSoloWorker(
        tenantId,
        'Card payment disputed',
        `A customer disputed a ${formatGbp(payment.amount)} card payment. Open Stripe to respond — you have a deadline.`,
      );
      return;
    }
    case 'charge.dispute.updated': {
      const dispute = event.data.object as Stripe.Dispute;
      const payment = await findPaymentForIntent(tenantId, dispute.payment_intent);
      if (!payment) {
        console.warn(
          '[connect-events] dispute.updated before payment row',
          paymentIntentId(dispute.payment_intent),
        );
        return;
      }
      const admin = createAdminClient();
      const { error } = await admin
        .from('payments')
        .update({ dispute_status: dispute.status })
        .eq('id', payment.id)
        .eq('tenant_id', tenantId);
      if (error) throw error;
      return;
    }
    case 'charge.dispute.closed': {
      const dispute = event.data.object as Stripe.Dispute;
      const payment = await findPaymentForIntent(tenantId, dispute.payment_intent);
      if (!payment) {
        console.warn(
          '[connect-events] dispute.closed before payment row',
          paymentIntentId(dispute.payment_intent),
        );
        return;
      }
      const admin = createAdminClient();
      const patch: { dispute_status: string; refunded_amount?: number } = {
        dispute_status: dispute.status ?? '',
      };
      if (dispute.status === 'lost') {
        patch.refunded_amount = payment.amount;
      }
      const { error } = await admin
        .from('payments')
        .update(patch)
        .eq('id', payment.id)
        .eq('tenant_id', tenantId);
      if (error) throw error;
      return;
    }
    default:
      return;
  }
}
