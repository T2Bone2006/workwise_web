import type { SupabaseClient } from '@supabase/supabase-js';
import { roundMoney } from '@/lib/money/pence';
import {
  normaliseAccountNumber,
  normaliseSortCode,
} from '@/lib/payments/bank-format';
import { generatePayToken } from '@/lib/payments/tokens';
import { makePaymentReference } from '@/lib/payments/reference';
import { termsFromSendsInvoice } from '@/lib/payments/terms';
import type { PaymentSettingsValues } from '@/lib/validations/payments';

export type PaymentMethod =
  | 'cash'
  | 'cheque'
  | 'bank_transfer'
  | 'card'
  | 'other';

/** `retryable`: a database/server failure worth retrying (phone APIs answer 503), not a bad request. */
export type MoneyResult<T = object> =
  | ({ success: true } & T)
  | { success: false; error: string; retryable?: boolean };

const FIVE_MIN_MS = 5 * 60 * 1000;
const FOUR_HUNDRED_DAYS_MS = 400 * 24 * 60 * 60 * 1000;

function clampReceivedAt(raw: string | null | undefined, now: Date): string {
  if (!raw) return now.toISOString();
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return now.toISOString();
  const t = parsed.getTime();
  const max = now.getTime() + FIVE_MIN_MS;
  const min = now.getTime() - FOUR_HUNDRED_DAYS_MS;
  if (t > max || t < min) return now.toISOString();
  return parsed.toISOString();
}

function isUniqueViolation(error: { code?: string; message?: string }): boolean {
  return error.code === '23505';
}

/** Data (22…) and constraint (23…) errors won't change on a retry; anything else might. */
function isRetryableDbError(error: { code?: string }): boolean {
  const code = error.code ?? '';
  return !code.startsWith('22') && !code.startsWith('23');
}

export async function recordPaymentCore(
  supabase: SupabaseClient,
  p: {
    tenantId: string;
    customerId: string;
    amount: number;
    method: PaymentMethod;
    receivedAt?: string | null;
    note?: string | null;
    appliesToJobId?: string | null;
    invoiceId?: string | null;
    clientMutationId?: string | null;
    userId: string | null;
  },
): Promise<MoneyResult<{ paymentId: string; duplicate: boolean }>> {
  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('id')
    .eq('id', p.customerId)
    .eq('tenant_id', p.tenantId)
    .maybeSingle();

  if (customerError) {
    console.error('recordPaymentCore customer lookup failed', customerError);
    return { success: false, error: 'Could not record the payment.', retryable: true };
  }
  if (!customer) {
    return { success: false, error: 'Customer not found.' };
  }

  if (p.appliesToJobId) {
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .select('id, customer_id')
      .eq('id', p.appliesToJobId)
      .eq('tenant_id', p.tenantId)
      .maybeSingle();
    if (jobError) {
      console.error('recordPaymentCore job lookup failed', jobError);
      return { success: false, error: 'Could not record the payment.', retryable: true };
    }
    if (
      !job ||
      (job as { customer_id?: string | null }).customer_id !== p.customerId
    ) {
      return {
        success: false,
        error: "That visit is not this customer's.",
      };
    }
  }

  const receivedAt = clampReceivedAt(p.receivedAt, new Date());
  const note =
    p.note == null || p.note.trim() === '' ? null : p.note.trim().slice(0, 300);

  const insertRow: Record<string, unknown> = {
    tenant_id: p.tenantId,
    customer_id: p.customerId,
    amount: roundMoney(p.amount),
    method: p.method,
    received_at: receivedAt,
    note,
    applies_to_job_id: p.appliesToJobId ?? null,
    invoice_id: p.invoiceId ?? null,
    recorded_by_user_id: p.userId,
    client_mutation_id: p.clientMutationId ?? null,
  };

  const { data, error } = await supabase
    .from('payments')
    .insert(insertRow)
    .select('id')
    .maybeSingle();

  if (error) {
    if (
      isUniqueViolation(error) &&
      (error.message ?? '').includes('client_mutation_id') &&
      p.clientMutationId
    ) {
      const { data: existing } = await supabase
        .from('payments')
        .select('id')
        .eq('client_mutation_id', p.clientMutationId)
        .maybeSingle();
      if (existing && typeof (existing as { id?: unknown }).id === 'string') {
        return {
          success: true,
          paymentId: (existing as { id: string }).id,
          duplicate: true,
        };
      }
      // The row exists but the lookup missed it — a retry will find it.
      return { success: false, error: 'Could not record the payment.', retryable: true };
    }
    console.error('recordPaymentCore insert failed', error);
    return {
      success: false,
      error: 'Could not record the payment.',
      retryable: isRetryableDbError(error),
    };
  }

  const id = data && typeof (data as { id?: unknown }).id === 'string'
    ? (data as { id: string }).id
    : null;
  if (!id) {
    return { success: false, error: 'Could not record the payment.', retryable: true };
  }
  return { success: true, paymentId: id, duplicate: false };
}

export async function voidPaymentCore(
  supabase: SupabaseClient,
  p: {
    tenantId: string;
    paymentId: string;
    reason?: string | null;
    userId: string | null;
  },
): Promise<MoneyResult> {
  const { data, error } = await supabase
    .from('payments')
    .select('id, status, source')
    .eq('id', p.paymentId)
    .eq('tenant_id', p.tenantId)
    .maybeSingle();

  if (error || !data) {
    return { success: false, error: 'Payment not found.' };
  }

  const row = data as { status: string; source: string };
  if (row.status === 'void') {
    return { success: true };
  }
  if (row.source !== 'manual') {
    return {
      success: false,
      error: 'Card payments are refunded in Stripe, not undone here.',
    };
  }

  const reason =
    p.reason == null || p.reason.trim() === ''
      ? null
      : p.reason.trim().slice(0, 300);

  const { error: updateError } = await supabase
    .from('payments')
    .update({
      status: 'void',
      voided_at: new Date().toISOString(),
      voided_by_user_id: p.userId,
      void_reason: reason,
    })
    .eq('id', p.paymentId)
    .eq('tenant_id', p.tenantId);

  if (updateError) {
    console.error('voidPaymentCore update failed', updateError);
    return { success: false, error: 'Could not undo the payment.' };
  }
  return { success: true };
}

export async function setVisitWaivedCore(
  supabase: SupabaseClient,
  p: { tenantId: string; jobId: string; waived: boolean },
): Promise<MoneyResult> {
  // Confirm the visit belongs to this tenant before calling the RPC.
  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('id')
    .eq('id', p.jobId)
    .eq('tenant_id', p.tenantId)
    .maybeSingle();
  if (jobError || !job) {
    return { success: false, error: 'Visit not found.' };
  }

  const { error } = await supabase.rpc('set_visit_waived', {
    p_job_id: p.jobId,
    p_waived: p.waived,
  });

  if (error) {
    if (error.code === '22023') {
      return { success: false, error: error.message || 'Invalid request.' };
    }
    if (error.code === '42501') {
      return { success: false, error: 'Not allowed' };
    }
    console.error('setVisitWaivedCore failed', error);
    return { success: false, error: 'Could not update the visit.' };
  }
  return { success: true };
}

export async function ensurePaymentReference(
  supabase: SupabaseClient,
  p: { tenantId: string; customerId: string },
): Promise<string | null> {
  const { data: customer, error } = await supabase
    .from('customers')
    .select('name, company_name, bank_reference_hint')
    .eq('id', p.customerId)
    .eq('tenant_id', p.tenantId)
    .maybeSingle();

  if (error || !customer) return null;

  const existing = (customer as { bank_reference_hint?: string | null })
    .bank_reference_hint;
  if (typeof existing === 'string' && existing.trim() !== '') {
    return existing;
  }

  const name =
    typeof (customer as { name?: unknown }).name === 'string'
      ? (customer as { name: string }).name
      : '';
  const companyName =
    typeof (customer as { company_name?: unknown }).company_name === 'string'
      ? (customer as { company_name: string }).company_name
      : null;

  const { data: refs } = await supabase
    .from('customers')
    .select('bank_reference_hint')
    .eq('tenant_id', p.tenantId)
    .not('bank_reference_hint', 'is', null);

  const taken = new Set<string>();
  for (const row of refs ?? []) {
    const hint = (row as { bank_reference_hint?: string | null })
      .bank_reference_hint;
    if (typeof hint === 'string' && hint.trim() !== '') {
      taken.add(hint.toUpperCase());
    }
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const reference = makePaymentReference(name, taken, { companyName });
    const { data: updated, error: updateError } = await supabase
      .from('customers')
      .update({ bank_reference_hint: reference })
      .eq('id', p.customerId)
      .eq('tenant_id', p.tenantId)
      .is('bank_reference_hint', null)
      .select('bank_reference_hint')
      .maybeSingle();

    if (updateError) {
      if (isUniqueViolation(updateError)) {
        taken.add(reference.toUpperCase());
        continue;
      }
      console.error('ensurePaymentReference update failed', updateError);
      return null;
    }

    const written = (updated as { bank_reference_hint?: string | null } | null)
      ?.bank_reference_hint;
    if (typeof written === 'string' && written.trim() !== '') {
      return written;
    }

    // Conditional update touched 0 rows — someone else set it.
    const { data: again } = await supabase
      .from('customers')
      .select('bank_reference_hint')
      .eq('id', p.customerId)
      .eq('tenant_id', p.tenantId)
      .maybeSingle();
    const now = (again as { bank_reference_hint?: string | null } | null)
      ?.bank_reference_hint;
    if (typeof now === 'string' && now.trim() !== '') return now;
    return null;
  }

  return null;
}

export async function ensurePayLinkToken(
  supabase: SupabaseClient,
  p: { tenantId: string; customerId: string },
): Promise<string | null> {
  const { data: customer, error } = await supabase
    .from('customers')
    .select('pay_link_token')
    .eq('id', p.customerId)
    .eq('tenant_id', p.tenantId)
    .maybeSingle();

  if (error || !customer) return null;

  const existing = (customer as { pay_link_token?: string | null }).pay_link_token;
  if (typeof existing === 'string' && existing.trim() !== '') {
    return existing;
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const token = generatePayToken();
    const { data: updated, error: updateError } = await supabase
      .from('customers')
      .update({ pay_link_token: token })
      .eq('id', p.customerId)
      .eq('tenant_id', p.tenantId)
      .is('pay_link_token', null)
      .select('pay_link_token')
      .maybeSingle();

    if (updateError) {
      if (isUniqueViolation(updateError)) continue;
      console.error('ensurePayLinkToken update failed', updateError);
      return null;
    }

    const written = (updated as { pay_link_token?: string | null } | null)
      ?.pay_link_token;
    if (typeof written === 'string' && written.trim() !== '') {
      return written;
    }

    const { data: again } = await supabase
      .from('customers')
      .select('pay_link_token')
      .eq('id', p.customerId)
      .eq('tenant_id', p.tenantId)
      .maybeSingle();
    const now = (again as { pay_link_token?: string | null } | null)
      ?.pay_link_token;
    if (typeof now === 'string' && now.trim() !== '') return now;
    return null;
  }

  return null;
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function friendlySettingsError(error: { message?: string; details?: string }): string {
  const blob = `${error.message ?? ''} ${error.details ?? ''}`;
  if (blob.includes('tps_sort_code_check')) return 'Sort code must be 6 digits';
  if (blob.includes('tps_account_number_check')) return 'Account number must be 8 digits';
  if (blob.includes('tps_vat_number_check')) return 'Enter your VAT number';
  return 'Could not save payment settings.';
}

/** Same write the dashboard Settings → Payments action uses. */
export async function savePaymentSettingsCore(
  supabase: SupabaseClient,
  tenantId: string,
  input: PaymentSettingsValues,
): Promise<MoneyResult> {
  const name = emptyToNull(input.bankAccountName);
  const sortRaw = emptyToNull(input.bankSortCode);
  const acctRaw = emptyToNull(input.bankAccountNumber);

  const bankSortCode = sortRaw ? normaliseSortCode(sortRaw) : null;
  const bankAccountNumber = acctRaw ? normaliseAccountNumber(acctRaw) : null;

  if (sortRaw && !bankSortCode) {
    return { success: false, error: 'Sort code must be 6 digits' };
  }
  if (acctRaw && !bankAccountNumber) {
    return { success: false, error: 'Account number must be 8 digits' };
  }

  const vatNumber = input.vatRegistered ? emptyToNull(input.vatNumber) : null;

  await ensurePaymentSettingsRow(supabase, tenantId);

  const { data, error } = await supabase
    .from('tenant_payment_settings')
    .update({
      bank_account_name: name,
      bank_sort_code: bankSortCode,
      bank_account_number: bankAccountNumber,
      vat_registered: input.vatRegistered,
      vat_number: vatNumber,
      invoice_due_days: input.invoiceDueDays,
      invoice_prefix: input.invoicePrefix,
      invoice_footer: emptyToNull(input.invoiceFooter),
    })
    .eq('tenant_id', tenantId)
    .select('tenant_id')
    .maybeSingle();

  if (error) {
    console.error('savePaymentSettingsCore', error);
    return { success: false, error: friendlySettingsError(error) };
  }
  if (!data) {
    return { success: false, error: 'Could not save payment settings.' };
  }
  return { success: true };
}

export async function ensurePaymentSettingsRow(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<void> {
  const { error } = await supabase
    .from('tenant_payment_settings')
    .insert({ tenant_id: tenantId });
  if (error && !isUniqueViolation(error)) {
    console.error('ensurePaymentSettingsRow insert failed', error);
  }
}

export async function setCustomerSendsInvoice(
  supabase: SupabaseClient,
  p: { tenantId: string; customerId: string; sendInvoice: boolean },
): Promise<void> {
  const terms = termsFromSendsInvoice(p.sendInvoice);
  const { data } = await supabase
    .from('customers')
    .select('payment_terms')
    .eq('id', p.customerId)
    .eq('tenant_id', p.tenantId)
    .maybeSingle();

  const current = (data as { payment_terms?: string | null } | null)
    ?.payment_terms;
  const currentNormalised =
    current === 'monthly_invoice' ? 'invoice' : current;
  if (currentNormalised === terms) return;

  const { error } = await supabase
    .from('customers')
    .update({ payment_terms: terms })
    .eq('id', p.customerId)
    .eq('tenant_id', p.tenantId);

  if (error) {
    console.error('setCustomerSendsInvoice update failed', error);
  }
}
