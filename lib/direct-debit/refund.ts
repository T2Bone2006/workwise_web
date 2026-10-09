import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { GoCardlessError } from '@/lib/gocardless/client';
import { clientForTenant } from '@/lib/gocardless/connection';
import { fromPence, toPence } from '@/lib/money/pence';

type Row = Record<string, unknown>;

export type RefundResult = { ok: true; refunded: number } | { ok: false; error: string };

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Plain-English version of what GoCardless said about a refused refund. */
export function refundErrorText(err: GoCardlessError): string {
  const reasons = err.reasons.join(' ');
  if (reasons.includes('available_refund_amount_insufficient')) {
    return "There isn't enough in your GoCardless refund balance to cover this. Check Available amounts for refunds in your GoCardless account settings.";
  }
  if (reasons.includes('total_amount_confirmation')) {
    return 'This payment was refunded a moment ago. Refresh the page and check before trying again.';
  }
  if (err.status === 401 || err.status === 403) {
    return "Refunds aren't switched on for your GoCardless account yet. Ask GoCardless support to enable them.";
  }
  if (err.status === 422 && err.message) return `GoCardless can't refund this yet: ${err.message}`;
  return "Couldn't send the refund to GoCardless. Try again in a minute.";
}

/**
 * Refund all or part of a GoCardless payment (Direct Debit or Pay by Bank). The refund is
 * created at GoCardless; the webhook then records it and tells the customer. Here we only
 * move `refunded_amount` up straight away so the screen is right before the webhook lands.
 */
export async function refundGoCardlessPayment(
  admin: SupabaseClient,
  p: { tenantId: string; userId: string; paymentId: string; amount: number },
): Promise<RefundResult> {
  const amountPence = Math.round(p.amount * 100);
  if (!Number.isFinite(amountPence) || amountPence < 1) return { ok: false, error: 'Enter an amount to refund.' };

  const { data, error } = await admin
    .from('payments')
    .select('id, amount, refunded_amount, status, source, dispute_status, gocardless_payment_id')
    .eq('id', p.paymentId)
    .eq('tenant_id', p.tenantId)
    .maybeSingle();
  if (error) return { ok: false, error: "Couldn't check that payment. Try again in a minute." };
  const payment = data as Row | null;
  const gcPaymentId = str(payment?.gocardless_payment_id);
  if (!payment || payment.source !== 'gocardless' || !gcPaymentId) {
    return { ok: false, error: "This payment wasn't taken through GoCardless, so it can't be refunded here." };
  }
  if (payment.status !== 'active') return { ok: false, error: 'This payment has been cancelled.' };
  if (payment.dispute_status === 'lost') return { ok: false, error: 'The customer already got this money back from their bank.' };

  const totalPence = toPence(Number(payment.amount));
  const refundedPence = toPence(Number(payment.refunded_amount ?? 0));
  const leftPence = totalPence - refundedPence;
  if (leftPence <= 0) return { ok: false, error: 'This payment has already been refunded in full.' };
  if (amountPence > leftPence) {
    return { ok: false, error: `You can refund up to £${(leftPence / 100).toFixed(2)} of this payment.` };
  }

  const unlocked = await clientForTenant(admin, p.tenantId);
  if (!unlocked) return { ok: false, error: 'GoCardless isn\'t connected. Reconnect it in Settings → Payments.' };

  try {
    await unlocked.client.post(
      '/refunds',
      {
        refunds: {
          amount: amountPence,
          total_amount_confirmation: refundedPence + amountPence,
          links: { payment: gcPaymentId },
          metadata: { workwise_payment_id: p.paymentId, workwise_user_id: p.userId },
        },
      },
      // Same payment, same amount already refunded, same new amount: a double tap is one refund.
      { idempotencyKey: `rf_${p.paymentId}_${refundedPence}_${amountPence}` },
    );
  } catch (err) {
    // 409: this exact refund already went through.
    if (!(err instanceof GoCardlessError && err.status === 409 && err.conflictingResourceId)) {
      if (err instanceof GoCardlessError) {
        console.error('[refund] GoCardless', { status: err.status, type: err.type, reasons: err.reasons });
        return { ok: false, error: refundErrorText(err) };
      }
      console.error('[refund] GoCardless', err instanceof Error ? err.message : 'error');
      return { ok: false, error: "Couldn't reach GoCardless. Try again in a minute." };
    }
  }

  const refunded = fromPence(refundedPence + amountPence);
  const { error: updateError } = await admin
    .from('payments')
    .update({ refunded_amount: refunded })
    .eq('id', p.paymentId)
    .eq('tenant_id', p.tenantId)
    .lt('refunded_amount', refunded);
  // The refund exists at GoCardless either way; the webhook records it if this write fails.
  if (updateError) console.error('[refund] recording', updateError.code);
  return { ok: true, refunded: fromPence(amountPence) };
}
