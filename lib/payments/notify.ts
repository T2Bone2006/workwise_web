import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildInvoiceEmail, formatInvoiceDueDate } from '@/lib/emails/invoice';
import {
  buildVisitDoneEmail,
  customerEmailFrom,
  emailDocument,
} from '@/lib/emails/visit-done';
import { getInvoice } from '@/lib/data/payments/invoices';
import { getCustomerBalance } from '@/lib/data/payments/owed';
import { getPaymentSettings, hasBankDetails } from '@/lib/data/payments/settings';
import { createInvoiceCore } from '@/lib/invoices/invoice-core';
import { renderInvoicePdf } from '@/lib/invoices/render';
import { toInvoiceViewModel } from '@/lib/invoices/view-model';
import { formatGbp, roundMoney } from '@/lib/money/pence';
import {
  composePaymentReceivedMessage,
  composeVisitDoneMessage,
} from '@/lib/payments/messages';
import {
  ensurePayLinkToken,
  type PaymentMethod,
} from '@/lib/payments/money-core';
import { sendsInvoice } from '@/lib/payments/terms';
import { invoiceLinkUrl, payLinkUrl } from '@/lib/payments/tokens';
import { createAdminClient } from '@/lib/supabase/admin';

export { customerEmailFrom };

export const VISIT_DONE_NOTIFICATION_TYPE = 'visit_done';
export const INVOICE_NOTIFICATION_TYPE = 'invoice';
export const PAYMENT_RECEIVED_NOTIFICATION_TYPE = 'payment_received';
export const PAY_LINK_NOTIFICATION_TYPE = 'pay_link';

type NoticeOutcome =
  | 'sent'
  | 'already_sent'
  | 'skipped_no_email'
  | 'skipped_opted_out'
  | 'skipped_waived'
  | 'failed';

const PAYMENT_METHODS = new Set<PaymentMethod>([
  'cash',
  'cheque',
  'bank_transfer',
  'card',
  'other',
]);

function asPaymentMethod(value: unknown): PaymentMethod | null {
  return typeof value === 'string' && PAYMENT_METHODS.has(value as PaymentMethod)
    ? (value as PaymentMethod)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

function ymd(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  const day = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

function visitTitle(raw: Record<string, unknown>): string {
  const cf = raw.custom_fields;
  if (cf && typeof cf === 'object' && !Array.isArray(cf)) {
    const rounds = (cf as { rounds?: unknown }).rounds;
    if (rounds && typeof rounds === 'object' && !Array.isArray(rounds)) {
      const name = (rounds as { service_name?: unknown }).service_name;
      if (typeof name === 'string' && name.trim() !== '') return name.trim();
    }
  }
  return asString(raw.job_description) ?? 'Visit';
}

function visitAddress(raw: Record<string, unknown>): string {
  const address = asString(raw.address) ?? '';
  const postcode = asString(raw.postcode);
  return postcode ? `${address}, ${postcode}` : address;
}

function companyBits(settings: unknown): { email: string | null; logoUrl: string | null } {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { email: null, logoUrl: null };
  }
  const company = (settings as { company?: unknown }).company;
  if (!company || typeof company !== 'object' || Array.isArray(company)) {
    return { email: null, logoUrl: null };
  }
  return {
    email: asString((company as { email?: unknown }).email),
    logoUrl: asString((company as { logo_url?: unknown }).logo_url),
  };
}

async function invoiceCardUrl(
  supabase: SupabaseClient,
  tenantId: string,
  publicToken: string,
): Promise<string | null> {
  const settings = await getPaymentSettings(supabase, tenantId);
  return settings.connect.status === 'active' ? invoiceLinkUrl(publicToken) : null;
}

async function replyToForTenant(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<string | null> {
  const { data: admins } = await supabase
    .from('users')
    .select('email')
    .eq('tenant_id', tenantId)
    .eq('role', 'admin')
    .eq('is_active', true)
    .limit(1);
  const email = asString(
    (admins?.[0] as { email?: unknown } | undefined)?.email,
  );
  return email;
}

/** Idempotent per visit. Never throws. */
export async function sendVisitDoneNotice(
  supabase: SupabaseClient,
  p: { tenantId: string; jobId: string },
): Promise<{
  outcome: NoticeOutcome;
  invoiceId?: string;
  error?: string;
}> {
  try {
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .select(
        'id, customer_id, status, payment_status, scheduled_date, completed_at, address, postcode, job_description, custom_fields, quoted_amount, final_amount',
      )
      .eq('id', p.jobId)
      .eq('tenant_id', p.tenantId)
      .maybeSingle();

    if (jobError || !job) {
      return { outcome: 'failed', error: jobError?.message ?? 'Visit not found' };
    }

    const row = job as Record<string, unknown>;
    if (asString(row.status) !== 'completed') {
      return { outcome: 'failed', error: 'Visit is not done' };
    }

    const customerId = asString(row.customer_id);
    if (!customerId) {
      return { outcome: 'failed', error: 'Visit has no customer' };
    }

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('name, email, preferred_channel, payment_terms, bank_reference_hint')
      .eq('id', customerId)
      .eq('tenant_id', p.tenantId)
      .maybeSingle();

    if (customerError || !customer) {
      return {
        outcome: 'failed',
        error: customerError?.message ?? 'Customer not found',
      };
    }

    const c = customer as Record<string, unknown>;
    const paymentStatus = asString(row.payment_status);
    if (paymentStatus === 'waived') return { outcome: 'skipped_waived' };
    if (asString(c.preferred_channel) === 'none') {
      return { outcome: 'skipped_opted_out' };
    }
    if (
      paymentStatus !== 'paid' &&
      paymentStatus !== 'partial' &&
      paymentStatus !== 'unpaid'
    ) {
      return { outcome: 'failed', error: 'Visit is not done' };
    }

    let invoiceId: string | undefined;
    let invoiceNumber: string | null = null;
    if (sendsInvoice(asString(c.payment_terms))) {
      const created = await createInvoiceCore(supabase, {
        tenantId: p.tenantId,
        customerId,
        scope: 'visit',
        jobId: p.jobId,
      });
      if (created.success) {
        invoiceId = created.invoiceId;
        invoiceNumber = created.number;
      } else {
        console.error('[sendVisitDoneNotice] invoice', p.jobId, created.error);
      }
    }

    const email = asString(c.email);
    if (!email) {
      return { outcome: 'skipped_no_email', invoiceId };
    }

    const admin = createAdminClient();
    const { data: claimed, error: claimError } = await admin
      .from('notifications')
      .insert({
        tenant_id: p.tenantId,
        job_id: p.jobId,
        type: VISIT_DONE_NOTIFICATION_TYPE,
        channel: 'email',
        recipient_type: 'customer',
        recipient_email: email,
        subject: '(pending)',
        body: '',
        status: 'pending',
        provider: 'resend',
      })
      .select('id')
      .single();

    if (claimError) {
      if (isUniqueViolation(claimError)) {
        return { outcome: 'already_sent', invoiceId };
      }
      console.error('[sendVisitDoneNotice] claim', claimError);
      return { outcome: 'failed', error: claimError.message, invoiceId };
    }

    const claimId = asString((claimed as { id?: unknown } | null)?.id);
    if (!claimId) {
      return { outcome: 'failed', error: 'Could not record the email', invoiceId };
    }

    const finish = async (
      patch: Record<string, unknown>,
      result: { outcome: NoticeOutcome; invoiceId?: string; error?: string },
    ) => {
      const { error } = await admin
        .from('notifications')
        .update(patch)
        .eq('id', claimId);
      if (error) console.error('[sendVisitDoneNotice] log', error);
      return result;
    };

    const [{ data: allocs }, { data: paidRows }, balance, settings, { data: tenant }] =
      await Promise.all([
        supabase
          .from('payment_allocations')
          .select('amount')
          .eq('job_id', p.jobId)
          .eq('tenant_id', p.tenantId),
        supabase
          .from('payments')
          .select('amount, method')
          .eq('applies_to_job_id', p.jobId)
          .eq('tenant_id', p.tenantId)
          .eq('status', 'active')
          .in('method', ['cash', 'cheque'])
          .order('received_at', { ascending: false })
          .limit(1),
        getCustomerBalance(supabase, p.tenantId, customerId),
        getPaymentSettings(supabase, p.tenantId),
        supabase
          .from('tenants')
          .select('name, settings')
          .eq('id', p.tenantId)
          .maybeSingle(),
      ]);

    let allocated = 0;
    for (const raw of allocs ?? []) {
      allocated += asFiniteNumber((raw as { amount?: unknown }).amount) ?? 0;
    }
    allocated = roundMoney(allocated);

    const visitDue = roundMoney(
      asFiniteNumber(row.final_amount) ?? asFiniteNumber(row.quoted_amount) ?? 0,
    );
    const visitOutstanding = Math.max(0, roundMoney(visitDue - allocated));

    const paid = (paidRows?.[0] ?? null) as { amount?: unknown; method?: unknown } | null;
    const paidMethod = asString(paid?.method);
    const paidAmount = asFiniteNumber(paid?.amount);
    const paidNow: { method: 'cash' | 'cheque'; amount: number } | null =
      (paidMethod === 'cash' || paidMethod === 'cheque') && paidAmount != null
        ? { method: paidMethod, amount: paidAmount }
        : null;

    const owed = balance.owedAmount;
    const token =
      owed > 0
        ? await ensurePayLinkToken(supabase, {
            tenantId: p.tenantId,
            customerId,
          })
        : null;
    const payUrl = token ? payLinkUrl(token) : null;

    const bank = hasBankDetails(settings)
      ? {
          accountName: settings.bankAccountName!,
          sortCode: settings.bankSortCode!,
          accountNumber: settings.bankAccountNumber!,
        }
      : null;

    const tenantRow = tenant as { name?: unknown; settings?: unknown } | null;
    const businessName = asString(tenantRow?.name) ?? 'Your cleaner';
    const company = companyBits(tenantRow?.settings);
    const visitDate =
      ymd(row.scheduled_date) ?? ymd(row.completed_at);
    if (!visitDate) {
      return finish(
        { status: 'failed', failed_reason: 'Visit has no date' },
        { outcome: 'failed', error: 'Visit has no date', invoiceId },
      );
    }

    const customerName = asString(c.name) ?? 'there';
    const msg = composeVisitDoneMessage({
      businessName,
      customerName,
      visitDate,
      serviceTitle: visitTitle(row),
      address: visitAddress(row),
      visitDue,
      paidNow,
      visitStatus: paymentStatus,
      visitOutstanding,
      customerOwedTotal: owed,
      customerCredit: balance.creditAmount,
      payUrl,
      bank,
      reference: asString(c.bank_reference_hint),
      invoiceNumber,
    });

    if (!msg) {
      return finish(
        { status: 'skipped', subject: '(skipped)' },
        { outcome: 'skipped_waived', invoiceId },
      );
    }

    const brand = { businessName, logoUrl: company.logoUrl };
    let attachment: { filename: string; content: Buffer } | null = null;
    let built: { subject: string; html: string; text: string };

    if (invoiceId && invoiceNumber) {
      const invoice = await getInvoice(supabase, p.tenantId, invoiceId);
      if (!invoice || invoice.status !== 'issued') {
        built = buildVisitDoneEmail(msg, brand);
      } else {
        const pdf = await renderInvoicePdf(
          toInvoiceViewModel(invoice, {
            cardUrl: await invoiceCardUrl(supabase, p.tenantId, invoice.publicToken),
          }),
        );
        attachment = { filename: `${invoice.number}.pdf`, content: pdf };
        built = buildInvoiceEmail({
          brand,
          invoice: {
            number: invoice.number,
            total: formatGbp(invoice.total),
            balanceDue: formatGbp(invoice.balanceDue),
            dueDate: formatInvoiceDueDate(invoice.dueDate),
            isPaid: invoice.balanceDue <= 0,
          },
          invoiceUrl: invoiceLinkUrl(invoice.publicToken),
          visitMessage: msg,
        });
      }
    } else {
      built = buildVisitDoneEmail(msg, brand);
    }

    const replyTo = company.email ?? (await replyToForTenant(supabase, p.tenantId));
    let providerMessageId: string | null = null;
    let failedReason: string | null = null;

    try {
      const { resend } = await import('@/lib/resend');
      const { data, error } = await resend.emails.send({
        from: customerEmailFrom(businessName),
        to: email,
        subject: built.subject,
        html: built.html,
        text: built.text,
        ...(replyTo ? { replyTo } : {}),
        ...(attachment ? { attachments: [attachment] } : {}),
      });
      if (error) failedReason = error.message;
      else providerMessageId = data?.id ?? null;
    } catch (err) {
      failedReason = err instanceof Error ? err.message : String(err);
    }

    if (!failedReason && attachment && invoiceId) {
      const { error: sentError } = await supabase
        .from('invoices')
        .update({
          sent_at: new Date().toISOString(),
          sent_to_email: email,
        })
        .eq('id', invoiceId)
        .eq('tenant_id', p.tenantId);
      if (sentError) console.error('[sendVisitDoneNotice] sent_at', sentError);
    }

    if (failedReason) {
      console.error('[sendVisitDoneNotice] resend', failedReason);
    }

    return finish(
      {
        subject: built.subject,
        body: built.html,
        status: failedReason ? 'failed' : 'sent',
        sent_at: failedReason ? null : new Date().toISOString(),
        failed_reason: failedReason,
        provider_message_id: providerMessageId,
      },
      failedReason
        ? { outcome: 'failed', error: failedReason, invoiceId }
        : { outcome: 'sent', invoiceId },
    );
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[sendVisitDoneNotice]', p.jobId, err);
    return { outcome: 'failed', error };
  }
}

/**
 * Email after Mark as paid (dashboard action or phone LOG_PAYMENT).
 * Not called from Done — visit-done already covers cash/cheque on the stop.
 * Idempotent per payment via notifications.recipient_id = paymentId.
 */
export async function sendPaymentReceivedNotice(
  supabase: SupabaseClient,
  p: { tenantId: string; paymentId: string },
): Promise<{ outcome: NoticeOutcome; error?: string }> {
  try {
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('id, customer_id, amount, method, status, applies_to_job_id')
      .eq('id', p.paymentId)
      .eq('tenant_id', p.tenantId)
      .maybeSingle();

    if (paymentError || !payment) {
      return {
        outcome: 'failed',
        error: paymentError?.message ?? 'Payment not found',
      };
    }

    const row = payment as Record<string, unknown>;
    if (asString(row.status) !== 'active') {
      return { outcome: 'failed', error: 'Payment is not active' };
    }

    const customerId = asString(row.customer_id);
    const amount = asFiniteNumber(row.amount);
    const method = asPaymentMethod(row.method);
    if (!customerId || amount == null || !method) {
      return { outcome: 'failed', error: 'Payment is incomplete' };
    }

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('name, email, preferred_channel, bank_reference_hint')
      .eq('id', customerId)
      .eq('tenant_id', p.tenantId)
      .maybeSingle();

    if (customerError || !customer) {
      return {
        outcome: 'failed',
        error: customerError?.message ?? 'Customer not found',
      };
    }

    const c = customer as Record<string, unknown>;
    if (asString(c.preferred_channel) === 'none') {
      return { outcome: 'skipped_opted_out' };
    }

    const email = asString(c.email);
    if (!email) return { outcome: 'skipped_no_email' };

    const admin = createAdminClient();
    const { data: existing } = await admin
      .from('notifications')
      .select('id')
      .eq('tenant_id', p.tenantId)
      .eq('type', PAYMENT_RECEIVED_NOTIFICATION_TYPE)
      .eq('recipient_id', p.paymentId)
      .maybeSingle();
    if (existing) return { outcome: 'already_sent' };

    const jobId = asString(row.applies_to_job_id);
    const { data: claimed, error: claimError } = await admin
      .from('notifications')
      .insert({
        tenant_id: p.tenantId,
        job_id: jobId,
        recipient_id: p.paymentId,
        type: PAYMENT_RECEIVED_NOTIFICATION_TYPE,
        channel: 'email',
        recipient_type: 'customer',
        recipient_email: email,
        subject: '(pending)',
        body: '',
        status: 'pending',
        provider: 'resend',
      })
      .select('id')
      .single();

    if (claimError) {
      if (isUniqueViolation(claimError)) return { outcome: 'already_sent' };
      console.error('[sendPaymentReceivedNotice] claim', claimError);
      return { outcome: 'failed', error: claimError.message };
    }

    const claimId = asString((claimed as { id?: unknown } | null)?.id);
    if (!claimId) {
      return { outcome: 'failed', error: 'Could not record the email' };
    }

    const finish = async (
      patch: Record<string, unknown>,
      result: { outcome: NoticeOutcome; error?: string },
    ) => {
      const { error } = await admin
        .from('notifications')
        .update(patch)
        .eq('id', claimId);
      if (error) console.error('[sendPaymentReceivedNotice] log', error);
      return result;
    };

    const [balance, settings, { data: tenant }] = await Promise.all([
      getCustomerBalance(supabase, p.tenantId, customerId),
      getPaymentSettings(supabase, p.tenantId),
      supabase
        .from('tenants')
        .select('name, settings')
        .eq('id', p.tenantId)
        .maybeSingle(),
    ]);

    const owed = balance.owedAmount;
    const token =
      owed > 0
        ? await ensurePayLinkToken(supabase, {
            tenantId: p.tenantId,
            customerId,
          })
        : null;
    const payUrl = token ? payLinkUrl(token) : null;
    const bank = hasBankDetails(settings)
      ? {
          accountName: settings.bankAccountName!,
          sortCode: settings.bankSortCode!,
          accountNumber: settings.bankAccountNumber!,
        }
      : null;

    const tenantRow = tenant as { name?: unknown; settings?: unknown } | null;
    const businessName = asString(tenantRow?.name) ?? 'Your cleaner';
    const company = companyBits(tenantRow?.settings);
    const msg = composePaymentReceivedMessage({
      businessName,
      customerName: asString(c.name) ?? 'there',
      amount,
      method,
      customerOwedTotal: owed,
      customerCredit: balance.creditAmount,
      payUrl,
      bank,
      reference: asString(c.bank_reference_hint),
    });
    const built = buildVisitDoneEmail(msg, {
      businessName,
      logoUrl: company.logoUrl,
    });
    const replyTo =
      company.email ?? (await replyToForTenant(supabase, p.tenantId));

    let providerMessageId: string | null = null;
    let failedReason: string | null = null;
    try {
      const { resend } = await import('@/lib/resend');
      const { data, error } = await resend.emails.send({
        from: customerEmailFrom(businessName),
        to: email,
        subject: built.subject,
        html: built.html,
        text: built.text,
        ...(replyTo ? { replyTo } : {}),
      });
      if (error) failedReason = error.message;
      else providerMessageId = data?.id ?? null;
    } catch (err) {
      failedReason = err instanceof Error ? err.message : String(err);
    }

    if (failedReason) {
      console.error('[sendPaymentReceivedNotice] resend', failedReason);
    }

    return finish(
      {
        subject: built.subject,
        body: built.html,
        status: failedReason ? 'failed' : 'sent',
        sent_at: failedReason ? null : new Date().toISOString(),
        failed_reason: failedReason,
        provider_message_id: providerMessageId,
      },
      failedReason
        ? { outcome: 'failed', error: failedReason }
        : { outcome: 'sent' },
    );
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[sendPaymentReceivedNotice]', p.paymentId, err);
    return { outcome: 'failed', error };
  }
}

/** Fire-and-forget after Mark as paid. Never throws. */
export async function afterManualPayment(
  supabase: SupabaseClient,
  p: { tenantId: string; paymentId: string; duplicate: boolean },
): Promise<void> {
  if (p.duplicate) return;
  try {
    await sendPaymentReceivedNotice(supabase, {
      tenantId: p.tenantId,
      paymentId: p.paymentId,
    });
  } catch (err) {
    console.error('[afterManualPayment]', p.paymentId, err);
  }
}

/** Manual send / resend of an existing invoice. */
export async function sendInvoiceEmail(
  supabase: SupabaseClient,
  p: { tenantId: string; invoiceId: string; to?: string | null },
): Promise<{ sent: boolean; error?: string }> {
  try {
    const invoice = await getInvoice(supabase, p.tenantId, p.invoiceId);
    if (!invoice) return { sent: false, error: 'Invoice not found' };
    if (invoice.status !== 'issued') {
      return { sent: false, error: 'Invoice is not issued' };
    }

    const to = asString(p.to) ?? invoice.billTo.email;
    if (!to) {
      return { sent: false, error: 'No email address for this customer' };
    }

    const { data: tenant } = await supabase
      .from('tenants')
      .select('name, settings')
      .eq('id', p.tenantId)
      .maybeSingle();
    const tenantRow = tenant as { name?: unknown; settings?: unknown } | null;
    const businessName = asString(tenantRow?.name) ?? invoice.seller.name;
    const company = companyBits(tenantRow?.settings);
    const brand = { businessName, logoUrl: company.logoUrl ?? invoice.seller.logoUrl };

    const built = buildInvoiceEmail({
      brand,
      invoice: {
        number: invoice.number,
        total: formatGbp(invoice.total),
        balanceDue: formatGbp(invoice.balanceDue),
        dueDate: formatInvoiceDueDate(invoice.dueDate),
        isPaid: invoice.balanceDue <= 0,
      },
      invoiceUrl: invoiceLinkUrl(invoice.publicToken),
      visitMessage: null,
    });

    const pdf = await renderInvoicePdf(
      toInvoiceViewModel(invoice, {
        cardUrl: await invoiceCardUrl(supabase, p.tenantId, invoice.publicToken),
      }),
    );
    const replyTo = company.email ?? (await replyToForTenant(supabase, p.tenantId));

    let providerMessageId: string | null = null;
    let failedReason: string | null = null;
    try {
      const { resend } = await import('@/lib/resend');
      const { data, error } = await resend.emails.send({
        from: customerEmailFrom(businessName),
        to,
        subject: built.subject,
        html: built.html,
        text: built.text,
        ...(replyTo ? { replyTo } : {}),
        attachments: [{ filename: `${invoice.number}.pdf`, content: pdf }],
      });
      if (error) failedReason = error.message;
      else providerMessageId = data?.id ?? null;
    } catch (err) {
      failedReason = err instanceof Error ? err.message : String(err);
    }

    const admin = createAdminClient();
    const { error: logError } = await admin.from('notifications').insert({
      tenant_id: p.tenantId,
      recipient_type: 'customer',
      recipient_email: to,
      type: INVOICE_NOTIFICATION_TYPE,
      channel: 'email',
      subject: built.subject,
      body: built.html,
      status: failedReason ? 'failed' : 'sent',
      sent_at: failedReason ? null : new Date().toISOString(),
      failed_reason: failedReason,
      provider: 'resend',
      provider_message_id: providerMessageId,
    });
    if (logError) console.error('[sendInvoiceEmail] notifications', logError);

    if (failedReason) {
      console.error('[sendInvoiceEmail] resend', failedReason);
      return { sent: false, error: failedReason };
    }

    const { error: sentError } = await supabase
      .from('invoices')
      .update({ sent_at: new Date().toISOString(), sent_to_email: to })
      .eq('id', invoice.id)
      .eq('tenant_id', p.tenantId);
    if (sentError) console.error('[sendInvoiceEmail] sent_at', sentError);

    return { sent: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[sendInvoiceEmail]', p.invoiceId, err);
    return { sent: false, error };
  }
}

/** Manual email of the customer's pay link (Share wording). Always allowed to resend. */
export async function sendPayLinkEmail(
  supabase: SupabaseClient,
  p: {
    tenantId: string;
    to: string;
    businessName: string;
    shareMessage: string;
    payUrl: string;
    tenantSettings: unknown;
  },
): Promise<{ sent: boolean; error?: string }> {
  try {
    const company = companyBits(p.tenantSettings);
    const brand = { businessName: p.businessName, logoUrl: company.logoUrl };
    const paragraphs = p.shareMessage
      .split(/(?<=[.!?])\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
    const subject = `Pay link from ${p.businessName}`;
    const greeting = 'Hello,';
    const signOff = `Thanks,\n${p.businessName}`;
    const html = emailDocument({
      subject,
      brand,
      greeting,
      paragraphs: paragraphs.length > 0 ? paragraphs : [p.shareMessage],
      payUrl: p.payUrl,
      payLabel: 'Pay now',
      bankLine: null,
      signOff,
    });
    const text = `${greeting}\n\n${p.shareMessage}\n\n${signOff}`;
    const replyTo =
      company.email ?? (await replyToForTenant(supabase, p.tenantId));

    let providerMessageId: string | null = null;
    let failedReason: string | null = null;
    try {
      const { resend } = await import('@/lib/resend');
      const { data, error } = await resend.emails.send({
        from: customerEmailFrom(p.businessName),
        to: p.to,
        subject,
        html,
        text,
        ...(replyTo ? { replyTo } : {}),
      });
      if (error) failedReason = error.message;
      else providerMessageId = data?.id ?? null;
    } catch (err) {
      failedReason = err instanceof Error ? err.message : String(err);
    }

    const admin = createAdminClient();
    const { error: logError } = await admin.from('notifications').insert({
      tenant_id: p.tenantId,
      recipient_type: 'customer',
      recipient_email: p.to,
      type: PAY_LINK_NOTIFICATION_TYPE,
      channel: 'email',
      subject,
      body: html,
      status: failedReason ? 'failed' : 'sent',
      sent_at: failedReason ? null : new Date().toISOString(),
      failed_reason: failedReason,
      provider: 'resend',
      provider_message_id: providerMessageId,
    });
    if (logError) console.error('[sendPayLinkEmail] notifications', logError);

    if (failedReason) {
      console.error('[sendPayLinkEmail] resend', failedReason);
      return { sent: false, error: failedReason };
    }
    return { sent: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[sendPayLinkEmail]', err);
    return { sent: false, error };
  }
}
