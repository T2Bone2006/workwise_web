import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadCollectionNumbers, amountToCollect } from '@/lib/direct-debit/collect';
import { prefilledCustomerFor } from '@/lib/direct-debit/setup';
import { getDirectDebitState } from '@/lib/direct-debit/state';
import { loadCustomerPayPage, loadInvoiceByToken } from '@/lib/data/payments/public-pay';
import { GoCardlessError } from '@/lib/gocardless/client';
import { clientForTenant } from '@/lib/gocardless/connection';
import { formatGbp, fromPence, toPence } from '@/lib/money/pence';
import { sendPaymentReceivedNotice } from '@/lib/payments/notify';
import { appBaseUrl } from '@/lib/payments/tokens';
import { sendOrHoldOwnerPush } from '@/lib/push/owner-push';

export type PayByBankKind = 'pay_by_bank' | 'pay_and_dd';
export type StartPayByBankResult =
  | { ok: true; url: string }
  | {
      ok: false;
      reason: 'not_available' | 'nothing_owed' | 'too_large' | 'already_set_up' | 'provider_error';
    };

/** What the webhook passes in: the billing request as GoCardless describes it. */
export type GcBillingRequest = {
  id?: string;
  links?: { payment_request_payment?: string; customer?: string };
  metadata?: Record<string, string>;
};

/** What the webhook passes in: the payment as GoCardless describes it now. */
export type GcPayment = {
  id?: string;
  status?: string;
  amount?: number;
};

const MIN_PAYMENT = 1; // £
const MAX_PAYMENT = 5000; // £

type Row = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

function logProvider(label: string, err: unknown): void {
  if (err instanceof GoCardlessError) {
    console.error(label, { status: err.status, type: err.type, reasons: err.reasons });
  } else {
    console.error(label, err instanceof Error ? err.name : 'error');
  }
}

/**
 * customer: the customer pay page. The amount is what they owe minus what is
 * already on its way (a Direct Debit collecting, or a bank payment approved but
 * not confirmed). A failed collection does not block it — that is exactly when
 * the customer pays another way.
 * invoice: an invoice pay page (amount = the invoice's outstanding; pay_and_dd
 * isn't offered).
 */
export async function startPayByBank(
  admin: SupabaseClient,
  p:
    | { from: 'customer'; payToken: string; kind: PayByBankKind }
    | { from: 'invoice'; invoiceToken: string },
): Promise<StartPayByBankResult> {
  const kind: PayByBankKind = p.from === 'customer' ? p.kind : 'pay_by_bank';

  // 1.
  let tenantId: string;
  let businessName: string;
  let customerId: string;
  let invoiceId: string | null = null;
  let invoiceAmount = 0;
  let pagePath: string;
  if (p.from === 'customer') {
    const page = await loadCustomerPayPage(p.payToken);
    if (!page) return { ok: false, reason: 'not_available' };
    tenantId = page.business.tenantId;
    businessName = page.business.name;
    customerId = page.customerId;
    pagePath = `/pay/${encodeURIComponent(p.payToken)}`;
  } else {
    const loaded = await loadInvoiceByToken(p.invoiceToken);
    if (!loaded || loaded.invoice.status === 'void') return { ok: false, reason: 'not_available' };
    tenantId = loaded.business.tenantId;
    businessName = loaded.business.name;
    customerId = loaded.invoice.customerId;
    invoiceId = loaded.invoice.id;
    invoiceAmount = loaded.invoice.balanceDue;
    pagePath = `/pay/i/${encodeURIComponent(p.invoiceToken)}`;
  }
  if ((await getDirectDebitState(admin, tenantId)) !== 'on') return { ok: false, reason: 'not_available' };
  const unlocked = await clientForTenant(admin, tenantId);
  if (!unlocked?.connection.organisation_id) return { ok: false, reason: 'not_available' };
  const { client, connection } = unlocked;

  // 2. The amount is worked out here, never taken from the form.
  let amount: number;
  if (p.from === 'customer') {
    try {
      const numbers = await loadCollectionNumbers(admin, tenantId, customerId);
      amount = amountToCollect({
        owed: numbers.owed,
        collecting: numbers.collecting,
        heldFailed: 0,
        payingByBank: numbers.payingByBank,
      });
    } catch (err) {
      console.error('[pay-by-bank] amount', err instanceof Error ? err.message : 'error');
      return { ok: false, reason: 'provider_error' };
    }
  } else {
    amount = fromPence(toPence(invoiceAmount));
  }
  if (amount < MIN_PAYMENT) return { ok: false, reason: 'nothing_owed' };
  if (amount > MAX_PAYMENT) return { ok: false, reason: 'too_large' };

  // 3.
  if (kind === 'pay_and_dd') {
    const { data, error } = await admin
      .from('customer_direct_debits')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .in('status', ['pending', 'active'])
      .limit(1);
    if (error) return { ok: false, reason: 'provider_error' };
    if (Array.isArray(data) && data.length > 0) return { ok: false, reason: 'already_set_up' };
  }

  let payRequestId: string | null = null;
  try {
    // 4.
    const minute = Math.floor(Date.now() / 60_000);
    const billingRequest = await client.post<{ billing_requests?: { id?: string } }>(
      '/billing_requests',
      {
        billing_requests: {
          payment_request: {
            amount: toPence(amount),
            currency: 'GBP',
            description: businessName.slice(0, 100),
          },
          ...(kind === 'pay_and_dd' ? { mandate_request: { scheme: 'bacs', currency: 'GBP' } } : {}),
          metadata: {
            workwise_tenant_id: tenantId,
            workwise_customer_id: customerId,
            workwise_kind: kind,
          },
        },
      },
      { idempotencyKey: `pbb_${customerId}_${invoiceId ?? 'x'}_${minute}` },
    );
    const billingRequestId = str(billingRequest.billing_requests?.id);
    if (!billingRequestId) {
      console.error('[pay-by-bank] billing request without an id');
      return { ok: false, reason: 'provider_error' };
    }

    // 5.
    const inserted = await admin
      .from('gocardless_pay_requests')
      .insert({
        tenant_id: tenantId,
        customer_id: customerId,
        ...(invoiceId ? { invoice_id: invoiceId } : {}),
        kind,
        amount,
        status: 'started',
        gocardless_organisation_id: connection.organisation_id,
        gocardless_billing_request_id: billingRequestId,
      })
      .select('id')
      .single();
    if (inserted.error) {
      if (!isUniqueViolation(inserted.error)) {
        console.error('[pay-by-bank] pay request row', inserted.error.code);
        return { ok: false, reason: 'provider_error' };
      }
      // The same billing request came back within the minute: reuse its row.
      const { data: existing } = await admin
        .from('gocardless_pay_requests')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('gocardless_billing_request_id', billingRequestId)
        .maybeSingle();
      payRequestId = str((existing as Row | null)?.id);
      if (!payRequestId) return { ok: false, reason: 'provider_error' };
    } else {
      payRequestId = str((inserted.data as Row | null)?.id);
    }

    // 6. Pay and set up: the Direct Debit row, filled in by the webhook's set-up handler.
    if (kind === 'pay_and_dd') {
      await admin
        .from('customer_direct_debits')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('customer_id', customerId)
        .eq('status', 'setting_up');
      const dd = await admin
        .from('customer_direct_debits')
        .insert({
          tenant_id: tenantId,
          customer_id: customerId,
          gocardless_organisation_id: connection.organisation_id,
          gocardless_billing_request_id: billingRequestId,
          source: 'workwise',
          status: 'setting_up',
        })
        .select('id')
        .single();
      if (dd.error) {
        console.error('[pay-by-bank] setting_up row', dd.error.code);
      } else if (payRequestId) {
        await admin
          .from('gocardless_pay_requests')
          .update({ direct_debit_id: str((dd.data as Row | null)?.id) })
          .eq('id', payRequestId);
      }
    }

    // 7.
    const { data: customerRow } = await admin
      .from('customers')
      .select('id, name, email, type, company_name, billing_address')
      .eq('id', customerId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    const prefilled = customerRow
      ? await prefilledCustomerFor(admin, tenantId, customerRow as Row)
      : { country_code: 'GB' };
    const page = `${appBaseUrl()}${pagePath}`;
    const flow = await client.post<{ billing_request_flows?: { authorisation_url?: string } }>(
      '/billing_request_flows',
      {
        billing_request_flows: {
          redirect_uri: `${page}?bank=done`,
          exit_uri: `${page}?bank=cancelled`,
          lock_currency: true,
          show_success_redirect_button: true,
          prefilled_customer: prefilled,
          links: { billing_request: billingRequestId },
        },
      },
      { idempotencyKey: `pbbflow_${billingRequestId}` },
    );

    // 8.
    const url = str(flow.billing_request_flows?.authorisation_url);
    if (!url) {
      console.error('[pay-by-bank] flow without a url');
      await markFailed(admin, payRequestId, 'GoCardless gave no page to send the customer to');
      return { ok: false, reason: 'provider_error' };
    }
    return { ok: true, url };
  } catch (err) {
    logProvider('[pay-by-bank] start', err);
    await markFailed(
      admin,
      payRequestId,
      err instanceof GoCardlessError ? `GoCardless refused it (${err.status})` : "Couldn't reach GoCardless",
    );
    return { ok: false, reason: 'provider_error' };
  }
}

async function markFailed(admin: SupabaseClient, payRequestId: string | null, message: string): Promise<void> {
  if (!payRequestId) return;
  const { error } = await admin
    .from('gocardless_pay_requests')
    .update({ status: 'failed', failure_message: message.slice(0, 300), finished_at: new Date().toISOString() })
    .eq('id', payRequestId)
    .eq('status', 'started');
  if (error) console.error('[pay-by-bank] could not mark failed', error.code);
}

/** Webhook (step 11): billing request fulfilled with kind pay_by_bank / pay_and_dd. */
export async function onPayRequestFulfilled(
  admin: SupabaseClient,
  tenantId: string,
  br: GcBillingRequest,
): Promise<void> {
  const billingRequestId = str(br.id);
  if (!billingRequestId) return;
  const { data, error } = await admin
    .from('gocardless_pay_requests')
    .select('id, status')
    .eq('tenant_id', tenantId)
    .eq('gocardless_billing_request_id', billingRequestId)
    .maybeSingle();
  if (error) throw new Error(`Reading pay request failed (${error.code ?? 'db'})`);
  const row = data as Row | null;
  if (!row) return;

  const paymentId = str(br.links?.payment_request_payment);
  if (row.status === 'started') {
    const { error: updateError } = await admin
      .from('gocardless_pay_requests')
      .update({
        status: 'fulfilled',
        fulfilled_at: new Date().toISOString(),
        gocardless_payment_id: paymentId,
      })
      .eq('id', String(row.id))
      .eq('status', 'started');
    if (updateError) throw new Error(`Updating pay request failed (${updateError.code ?? 'db'})`);
  }
  if (!paymentId) return;

  // Pay by Bank usually confirms within seconds: don't wait for another event.
  const unlocked = await clientForTenant(admin, tenantId);
  if (!unlocked) throw new Error('Could not open the GoCardless connection');
  const json = await unlocked.client.get<{ payments?: GcPayment }>(`/payments/${encodeURIComponent(paymentId)}`);
  const payment = json.payments;
  if (payment && (payment.status === 'confirmed' || payment.status === 'paid_out')) {
    await onPayRequestPayment(admin, tenantId, payment, new Date().toISOString());
  }
}

/** Webhook (step 11): a payment whose id is on a gocardless_pay_requests row. */
export async function onPayRequestPayment(
  admin: SupabaseClient,
  tenantId: string,
  payment: GcPayment,
  eventCreatedAt: string,
): Promise<void> {
  const gcPaymentId = str(payment.id);
  if (!gcPaymentId) return;
  const { data, error } = await admin
    .from('gocardless_pay_requests')
    .select('id, customer_id, invoice_id, status, payment_id')
    .eq('tenant_id', tenantId)
    .eq('gocardless_payment_id', gcPaymentId)
    .maybeSingle();
  if (error) throw new Error(`Reading pay request failed (${error.code ?? 'db'})`);
  const row = data as Row | null;
  if (!row) return;
  const status = payment.status ?? '';

  if (status === 'confirmed' || status === 'paid_out') {
    const amount = fromPence(Number(payment.amount));
    let paymentId: string | null = null;
    const inserted = await admin
      .from('payments')
      .insert({
        tenant_id: tenantId,
        customer_id: row.customer_id,
        amount,
        method: 'pay_by_bank',
        source: 'gocardless',
        status: 'active',
        received_at: str(eventCreatedAt) ?? new Date().toISOString(),
        gocardless_payment_id: gcPaymentId,
        ...(row.invoice_id ? { invoice_id: row.invoice_id } : {}),
        recorded_by_user_id: null,
      })
      .select('id')
      .single();
    if (inserted.error) {
      if (!isUniqueViolation(inserted.error)) {
        throw new Error(`Recording payment failed (${inserted.error.code ?? 'db'})`);
      }
      const { data: existing } = await admin
        .from('payments')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('gocardless_payment_id', gcPaymentId)
        .maybeSingle();
      paymentId = str((existing as Row | null)?.id);
      if (!paymentId) throw new Error('Recording payment failed (duplicate, but not found)');
    } else {
      paymentId = str((inserted.data as Row | null)?.id);
      if (!paymentId) throw new Error('Recording payment failed (no id)');
    }

    const { data: finished, error: finishError } = await admin
      .from('gocardless_pay_requests')
      .update({ status: 'paid', payment_id: paymentId, finished_at: new Date().toISOString() })
      .eq('id', String(row.id))
      .neq('status', 'paid')
      .select('id');
    if (finishError) throw new Error(`Finishing pay request failed (${finishError.code ?? 'db'})`);
    if (!Array.isArray(finished) || finished.length === 0) return; // already done: no second thank-you or push

    try {
      await sendPaymentReceivedNotice(admin, { tenantId, paymentId });
    } catch (err) {
      console.error('[pay-by-bank] thank-you', err instanceof Error ? err.message : 'error');
    }
    try {
      const { data: customer } = await admin
        .from('customers')
        .select('name')
        .eq('id', String(row.customer_id))
        .eq('tenant_id', tenantId)
        .maybeSingle();
      const name = str((customer as Row | null)?.name) ?? 'A customer';
      await sendOrHoldOwnerPush(admin, tenantId, {
        kind: 'card_payment',
        title: 'Payment received',
        body: `${formatGbp(amount)} from ${name} by bank`,
        data: { type: 'card_payment', amount, customerId: String(row.customer_id), customerName: name },
      });
    } catch (err) {
      console.error('[pay-by-bank] push', err instanceof Error ? err.message : 'error');
    }
    return;
  }

  if (status === 'failed' || status === 'cancelled' || status === 'customer_approval_denied') {
    // A failure after confirmation takes the payment back off.
    const writtenId = str(row.payment_id);
    if (writtenId) {
      const { error: voidError } = await admin
        .from('payments')
        .update({
          status: 'void',
          voided_at: new Date().toISOString(),
          void_reason: 'Pay by Bank failed after confirmation',
        })
        .eq('id', writtenId)
        .eq('tenant_id', tenantId)
        .eq('status', 'active');
      if (voidError) throw new Error(`Voiding payment failed (${voidError.code ?? 'db'})`);
    }
    const { error: updateError } = await admin
      .from('gocardless_pay_requests')
      .update({
        status: status === 'failed' ? 'failed' : 'cancelled',
        failure_message: `Payment ${status.replace(/_/g, ' ')}`.slice(0, 300),
        finished_at: new Date().toISOString(),
      })
      .eq('id', String(row.id))
      .in('status', ['started', 'fulfilled', 'paid']);
    if (updateError) throw new Error(`Updating pay request failed (${updateError.code ?? 'db'})`);
  }
}
