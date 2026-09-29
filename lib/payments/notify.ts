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
import { getTenantMessagingContext } from '@/lib/messaging/brand';
import type { Channel } from '@/lib/messaging/channel';
import { isUkMobileE164 } from '@/lib/messaging/phone';
import type { EmailAttempt, SendOutcome } from '@/lib/messaging/send';
import { paymentReceivedSms } from '@/lib/messaging/templates';
import { formatGbp, roundMoney } from '@/lib/money/pence';
import {
  composePaymentReceivedMessage,
  composeVisitDoneMessage,
  composeVisitDoneSms,
  paymentMethodLabel,
  type ComposedMessage,
  type VisitDoneMessageInput,
} from '@/lib/payments/messages';
import {
  ensurePayLinkToken,
  type PaymentMethod,
} from '@/lib/payments/money-core';
import { sendsInvoice } from '@/lib/payments/terms';
import { invoiceLinkUrl, payLinkUrl } from '@/lib/payments/tokens';
import { todayInLondon } from '@/lib/rounds/dates';
import { houseKey } from '@/lib/rounds/house-stops';
import { RESCHEDULE_STATUSES } from '@/lib/rounds/visit-statuses';
import { visitServiceTitle } from '@/lib/rounds/visit-title';
import { createAdminClient } from '@/lib/supabase/admin';

export { customerEmailFrom };

export const VISIT_DONE_NOTIFICATION_TYPE = 'visit_done';
export const INVOICE_NOTIFICATION_TYPE = 'invoice';
export const PAYMENT_RECEIVED_NOTIFICATION_TYPE = 'payment_received';
export const PAY_LINK_NOTIFICATION_TYPE = 'pay_link';

export type NoticeOutcome =
  | 'sent'
  | 'held'
  | 'already_sent'
  | 'skipped_no_channel'
  | 'skipped_opted_out'
  | 'skipped_waived'
  | 'skipped_no_texts'
  | 'waiting_for_stop'
  | 'failed';

type NoticeResult = {
  outcome: NoticeOutcome;
  channel?: 'sms' | 'email';
  invoiceId?: string;
  error?: string;
};

type RememberedEmail = {
  sent: boolean;
  error?: string;
  subject: string;
  html: string;
  providerMessageId: string | null;
};

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

/** completed_at is a timestamp; the customer's day is the London date. */
function completedDay(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : todayInLondon(at);
}

function visitAddress(raw: Record<string, unknown>): string {
  const address = asString(raw.address) ?? '';
  const postcode = asString(raw.postcode);
  return postcode ? `${address}, ${postcode}` : address;
}

const JOB_COLUMNS =
  'id, customer_id, status, payment_status, scheduled_date, completed_at, address, postcode, job_description, custom_fields, quoted_amount, final_amount';

const OPEN_STATUSES = new Set<string>(RESCHEDULE_STATUSES);

function houseOf(raw: Record<string, unknown>) {
  return {
    id: asString(raw.id) ?? '',
    customer_id: asString(raw.customer_id),
    address: asString(raw.address) ?? '',
    postcode: asString(raw.postcode) ?? '',
  };
}

/**
 * The other services at the same house on the same day (the stop), this visit
 * included. One visit-done message covers the whole stop (owner, 2026-09-29).
 */
async function loadStopVisits(
  supabase: SupabaseClient,
  tenantId: string,
  row: Record<string, unknown>,
): Promise<{ open: boolean; done: Record<string, unknown>[] }> {
  const customerId = asString(row.customer_id);
  const day = ymd(row.scheduled_date);
  let rows: Record<string, unknown>[] = [];
  if (customerId && day) {
    const { data, error } = await supabase
      .from('jobs')
      .select(JOB_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .eq('scheduled_date', day);
    if (error) {
      console.error('[visit done] stop visits', error.message);
    } else if (Array.isArray(data)) {
      rows = data as Record<string, unknown>[];
    }
  }
  const key = houseKey(houseOf(row));
  const stop = rows.filter((other) => houseKey(houseOf(other)) === key);
  if (!stop.some((other) => asString(other.id) === asString(row.id))) stop.push(row);

  const open = stop.some((other) => OPEN_STATUSES.has(asString(other.status) ?? ''));
  const done = stop
    .filter(
      (other) =>
        asString(other.status) === 'completed' &&
        asString(other.payment_status) !== 'waived',
    )
    .sort((a, b) => ((asString(a.id) ?? '') < (asString(b.id) ?? '') ? -1 : 1));
  return { open, done };
}

/** paid only when every visit is; unpaid only when none has anything allocated. */
function stopPaymentStatus(
  statuses: string[],
): 'paid' | 'partial' | 'unpaid' | null {
  if (statuses.length === 0) return null;
  if (statuses.some((s) => s !== 'paid' && s !== 'partial' && s !== 'unpaid')) return null;
  if (statuses.every((s) => s === 'paid')) return 'paid';
  if (statuses.every((s) => s === 'unpaid')) return 'unpaid';
  return 'partial';
}

function joinTitles(titles: string[]): string {
  const unique = [...new Set(titles.map((t) => t.trim()).filter(Boolean))];
  if (unique.length <= 1) return unique[0] ?? 'Visit';
  return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`;
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

function doorToNotice(
  door: SendOutcome,
  email: RememberedEmail | null,
  textBody: string,
): { patch: Record<string, unknown> | null; result: NoticeResult } {
  if (door.outcome === 'email_sent') {
    return {
      patch: {
        channel: 'email',
        provider: 'resend',
        status: 'sent',
        subject: email?.subject ?? '(email)',
        body: email?.html ?? '',
        sent_at: new Date().toISOString(),
        provider_message_id: email?.providerMessageId ?? null,
      },
      result: { outcome: 'sent', channel: 'email' },
    };
  }
  if (door.outcome === 'text_sent') {
    return {
      patch: {
        channel: 'sms',
        provider: 'puresms',
        status: 'sent',
        subject: '(text)',
        body: textBody,
        sent_at: new Date().toISOString(),
      },
      result: { outcome: 'sent', channel: 'sms' },
    };
  }
  if (door.outcome === 'text_held') {
    return {
      patch: {
        channel: 'sms',
        status: 'held',
        body: textBody,
      },
      result: { outcome: 'held', channel: 'sms' },
    };
  }
  if (door.outcome === 'duplicate') {
    return { patch: null, result: { outcome: 'already_sent' } };
  }
  if (door.outcome === 'skipped') {
    const outcome: NoticeOutcome =
      door.reason === 'opted_out'
        ? 'skipped_opted_out'
        : door.reason === 'no_texts_left'
          ? 'skipped_no_texts'
          : 'skipped_no_channel';
    return {
      patch: { status: 'skipped', failed_reason: door.reason },
      result: { outcome },
    };
  }
  return {
    patch: { status: 'failed', failed_reason: door.error },
    result: { outcome: 'failed', error: door.error },
  };
}

/** Phase 2 visit-done email (PDF when there is an issued invoice). Never throws out. */
async function buildAndSendVisitDoneEmail(
  supabase: SupabaseClient,
  p: {
    tenantId: string;
    email: string;
    businessName: string;
    logoUrl: string | null;
    replyTo: string | null;
    msg: ComposedMessage;
    invoiceId?: string;
    invoiceNumber: string | null;
  },
): Promise<RememberedEmail> {
  const brand = { businessName: p.businessName, logoUrl: p.logoUrl };
  let attachment: { filename: string; content: Buffer } | null = null;
  let built: { subject: string; html: string; text: string };

  if (p.invoiceId && p.invoiceNumber) {
    const invoice = await getInvoice(supabase, p.tenantId, p.invoiceId);
    if (!invoice || invoice.status !== 'issued') {
      built = buildVisitDoneEmail(p.msg, brand);
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
        visitMessage: p.msg,
      });
    }
  } else {
    built = buildVisitDoneEmail(p.msg, brand);
  }

  let providerMessageId: string | null = null;
  let failedReason: string | null = null;
  try {
    const { resend } = await import('@/lib/resend');
    const { data, error } = await resend.emails.send({
      from: customerEmailFrom(p.businessName),
      to: p.email,
      subject: built.subject,
      html: built.html,
      text: built.text,
      ...(p.replyTo ? { replyTo: p.replyTo } : {}),
      ...(attachment ? { attachments: [attachment] } : {}),
    });
    if (error) failedReason = error.message;
    else providerMessageId = data?.id ?? null;
  } catch (err) {
    failedReason = err instanceof Error ? err.message : String(err);
  }

  if (!failedReason && attachment && p.invoiceId) {
    const { error: sentError } = await supabase
      .from('invoices')
      .update({
        sent_at: new Date().toISOString(),
        sent_to_email: p.email,
      })
      .eq('id', p.invoiceId)
      .eq('tenant_id', p.tenantId);
    if (sentError) console.error('[sendVisitDoneNotice] sent_at', sentError);
  }

  if (failedReason) {
    console.error('[sendVisitDoneNotice] resend', failedReason);
  }

  return {
    sent: !failedReason,
    error: failedReason ?? undefined,
    subject: built.subject,
    html: built.html,
    providerMessageId,
  };
}

type AssembledVisitDone = {
  msg: ComposedMessage;
  input: VisitDoneMessageInput;
  visitDate: string;
  businessName: string;
  logoUrl: string | null;
  replyTo: string | null;
  invoiceUrl: string | null;
  contactPhone: string | null;
};

async function assembleVisitDone(
  supabase: SupabaseClient,
  p: {
    tenantId: string;
    customerId: string;
    customer: Record<string, unknown>;
    /** Every service done at this stop; the first is the primary visit. */
    jobs: Record<string, unknown>[];
    invoiceId?: string;
    invoiceNumber: string | null;
    paymentStatus: 'paid' | 'partial' | 'unpaid';
  },
): Promise<
  | { ok: false; error: string; waived?: boolean }
  | { ok: true; assembled: AssembledVisitDone }
> {
  const jobIds = p.jobs.map((job) => asString(job.id)).filter((id): id is string => id != null);
  const primary = p.jobs[0] ?? {};
  const [{ data: allocs }, { data: paidRows }, balance, settings, { data: tenant }] =
    await Promise.all([
      supabase
        .from('payment_allocations')
        .select('amount')
        .in('job_id', jobIds)
        .eq('tenant_id', p.tenantId),
      supabase
        .from('payments')
        .select('amount, method')
        .in('applies_to_job_id', jobIds)
        .eq('tenant_id', p.tenantId)
        .eq('status', 'active')
        .in('method', ['cash', 'cheque'])
        .order('received_at', { ascending: false })
        .limit(1),
      getCustomerBalance(supabase, p.tenantId, p.customerId),
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

  let visitDue = 0;
  for (const job of p.jobs) {
    visitDue += asFiniteNumber(job.final_amount) ?? asFiniteNumber(job.quoted_amount) ?? 0;
  }
  visitDue = roundMoney(visitDue);
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
          customerId: p.customerId,
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
  // The day it was actually done, not the day it was planned: a visit done
  // early (or late) must not say "done on Fri" when it was done on Tuesday.
  const visitDate = completedDay(primary.completed_at) ?? ymd(primary.scheduled_date);
  if (!visitDate) {
    return { ok: false, error: 'Visit has no date' };
  }

  const input: VisitDoneMessageInput = {
    businessName,
    customerName: asString(p.customer.name) ?? 'there',
    visitDate,
    serviceTitle: joinTitles(p.jobs.map((job) => visitServiceTitle(job))),
    address: visitAddress(primary),
    visitDue,
    paidNow,
    visitStatus: p.paymentStatus,
    visitOutstanding,
    customerOwedTotal: owed,
    customerCredit: balance.creditAmount,
    payUrl,
    bank,
    reference: asString(p.customer.bank_reference_hint),
    invoiceNumber: p.invoiceNumber,
  };
  const msg = composeVisitDoneMessage(input);
  if (!msg) return { ok: false, error: 'Waived', waived: true };

  let invoiceUrl: string | null = null;
  if (p.invoiceId) {
    const invoice = await getInvoice(supabase, p.tenantId, p.invoiceId);
    if (invoice?.status === 'issued') {
      invoiceUrl = invoiceLinkUrl(invoice.publicToken);
    }
  }

  const messaging = await getTenantMessagingContext(supabase, p.tenantId);
  return {
    ok: true,
    assembled: {
      msg,
      input,
      visitDate,
      businessName,
      logoUrl: company.logoUrl,
      replyTo: company.email ?? (await replyToForTenant(supabase, p.tenantId)),
      invoiceUrl,
      contactPhone: messaging?.contactPhone ?? null,
    },
  };
}

/**
 * One visit-done message per stop (every service at the house that day).
 * Waits while another service at the stop is still to do: the last Done sends
 * for all of them. `force` sends for what is done now (evening sweep).
 * Idempotent per visit (each visit is claimed once). Never throws.
 */
export async function sendVisitDoneNotice(
  supabase: SupabaseClient,
  p: { tenantId: string; jobId: string; force?: boolean },
): Promise<NoticeResult> {
  try {
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .select(JOB_COLUMNS)
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

    const stop = await loadStopVisits(supabase, p.tenantId, row);
    if (stop.open && !p.force) return { outcome: 'waiting_for_stop' };

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select(
        'name, email, phone_e164, preferred_channel, payment_terms, bank_reference_hint',
      )
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
    if (stop.done.length === 0) return { outcome: 'skipped_waived' };
    if (asString(c.preferred_channel) === 'none') {
      return { outcome: 'skipped_opted_out' };
    }

    const email = asString(c.email);
    const phone = asString(c.phone_e164);
    const reachable = Boolean(email) || isUkMobileE164(phone);

    // Claim each visit before sending (unique per visit): a replay, or a
    // stop already told, drops out here and is never messaged twice.
    const admin = reachable ? createAdminClient() : null;
    const claimIds: string[] = [];
    const jobs: Record<string, unknown>[] = [];
    if (admin) {
      for (const visit of stop.done) {
        const visitId = asString(visit.id);
        if (!visitId) continue;
        const { data: claimed, error: claimError } = await admin
          .from('notifications')
          .insert({
            tenant_id: p.tenantId,
            job_id: visitId,
            type: VISIT_DONE_NOTIFICATION_TYPE,
            channel: 'auto',
            recipient_type: 'customer',
            recipient_email: email ?? null,
            recipient_phone: phone ?? null,
            subject: '(pending)',
            body: '',
            status: 'pending',
            provider: null,
          })
          .select('id')
          .single();
        if (claimError) {
          if (isUniqueViolation(claimError)) continue;
          console.error('[sendVisitDoneNotice] claim', claimError);
          continue;
        }
        const claimId = asString((claimed as { id?: unknown } | null)?.id);
        if (!claimId) continue;
        claimIds.push(claimId);
        jobs.push(visit);
      }
      if (jobs.length === 0) return { outcome: 'already_sent' };
    } else {
      jobs.push(...stop.done);
    }

    const jobIds = jobs.map((visit) => asString(visit.id) as string);
    const paymentStatus = stopPaymentStatus(
      jobs.map((visit) => asString(visit.payment_status) ?? ''),
    );

    let invoiceId: string | undefined;
    let invoiceNumber: string | null = null;
    if (sendsInvoice(asString(c.payment_terms)) && paymentStatus) {
      const created = await createInvoiceCore(supabase, {
        tenantId: p.tenantId,
        customerId,
        scope: 'visit',
        jobId: jobIds[0],
        jobIds,
      });
      if (created.success) {
        invoiceId = created.invoiceId;
        invoiceNumber = created.number;
      } else {
        console.error('[sendVisitDoneNotice] invoice', p.jobId, created.error);
      }
    }

    if (!admin) return { outcome: 'skipped_no_channel', invoiceId };

    const finish = async (patch: Record<string, unknown>, result: NoticeResult) => {
      for (const claimId of claimIds) {
        const { error } = await admin
          .from('notifications')
          .update(patch)
          .eq('id', claimId);
        if (error) console.error('[sendVisitDoneNotice] log', error);
      }
      return { ...result, invoiceId };
    };

    if (!paymentStatus) {
      return finish(
        { status: 'failed', failed_reason: 'Visit is not done' },
        { outcome: 'failed', error: 'Visit is not done' },
      );
    }

    const assembled = await assembleVisitDone(supabase, {
      tenantId: p.tenantId,
      customerId,
      customer: c,
      jobs,
      invoiceId,
      invoiceNumber,
      paymentStatus,
    });
    if (!assembled.ok) {
      if (assembled.waived) {
        return finish(
          { status: 'skipped', subject: '(skipped)' },
          { outcome: 'skipped_waived', invoiceId },
        );
      }
      return finish(
        { status: 'failed', failed_reason: assembled.error },
        { outcome: 'failed', error: assembled.error, invoiceId },
      );
    }

    const facts = assembled.assembled;
    let remembered: RememberedEmail | null = null;
    const emailAttempt: EmailAttempt = async () => {
      remembered = await buildAndSendVisitDoneEmail(supabase, {
        tenantId: p.tenantId,
        email: email as string,
        businessName: facts.businessName,
        logoUrl: facts.logoUrl,
        replyTo: facts.replyTo,
        msg: facts.msg,
        invoiceId,
        invoiceNumber,
      });
      return { sent: remembered.sent, error: remembered.error };
    };

    let textBody = '';
    const channelOrderOverride: Channel[] | undefined =
      invoiceId && email ? ['email', 'text'] : undefined;
    const { sendCustomerMessage } = await import('@/lib/messaging/send');
    const door = await sendCustomerMessage({
      tenantId: p.tenantId,
      customerId,
      kind: 'visit_done',
      dedupeKey: `visit_done:${jobIds[0]}`,
      text: () => {
        const sms = composeVisitDoneSms(facts.input, {
          services: jobs.map((visit) => visitServiceTitle(visit)),
          visitDate: facts.visitDate,
          today: todayInLondon(),
          invoiceUrl: facts.invoiceUrl,
          contactPhone: facts.contactPhone,
        });
        if (!sms) {
          throw new Error('composeVisitDoneSms returned null');
        }
        textBody = sms;
        return sms;
      },
      email: email ? emailAttempt : null,
      jobIds,
      bindThread: false,
      channelOrderOverride,
    });

    const mapped = doorToNotice(door, remembered, textBody);
    if (!mapped.patch) {
      return { ...mapped.result, invoiceId };
    }
    return finish(mapped.patch, mapped.result);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[sendVisitDoneNotice]', p.jobId, err);
    return { outcome: 'failed', error };
  }
}

/**
 * After a Skip: if that finished the stop, send the visit-done message for
 * the services already done there. Never throws.
 */
export async function sendVisitDoneAfterSkip(
  supabase: SupabaseClient,
  p: { tenantId: string; jobId: string },
): Promise<void> {
  try {
    const { data: job } = await supabase
      .from('jobs')
      .select(JOB_COLUMNS)
      .eq('id', p.jobId)
      .eq('tenant_id', p.tenantId)
      .maybeSingle();
    if (!job) return;
    const stop = await loadStopVisits(supabase, p.tenantId, job as Record<string, unknown>);
    const first = stop.done[0];
    const firstId = first ? asString(first.id) : null;
    if (stop.open || !firstId) return;
    await sendVisitDoneNotice(supabase, { tenantId: p.tenantId, jobId: firstId });
  } catch (err) {
    console.error('[sendVisitDoneAfterSkip]', p.jobId, err);
  }
}

/**
 * Evening sweep: a visit done 20+ minutes ago whose stop still has a service
 * not done (left for another day) gets its message now. Never throws.
 */
export async function sendWaitingVisitDoneNotices(
  admin: SupabaseClient,
  p: { tenantId: string; now?: Date },
): Promise<{ sent: number }> {
  let sent = 0;
  try {
    const now = p.now ?? new Date();
    const from = new Date(now.getTime() - 3 * 86_400_000).toISOString();
    const until = new Date(now.getTime() - 20 * 60_000).toISOString();
    const { data, error } = await admin
      .from('jobs')
      .select('id')
      .eq('tenant_id', p.tenantId)
      .eq('status', 'completed')
      .not('payment_status', 'is', null)
      .gte('completed_at', from)
      .lte('completed_at', until)
      .limit(200);
    if (error) {
      console.error('[sendWaitingVisitDoneNotices] jobs', error.message);
      return { sent };
    }
    const ids = ((data ?? []) as { id?: unknown }[])
      .map((row) => asString(row.id))
      .filter((id): id is string => id != null);
    if (ids.length === 0) return { sent };

    const { data: told, error: toldError } = await admin
      .from('notifications')
      .select('job_id')
      .eq('type', VISIT_DONE_NOTIFICATION_TYPE)
      .in('job_id', ids);
    if (toldError) {
      console.error('[sendWaitingVisitDoneNotices] notifications', toldError.message);
      return { sent };
    }
    const done = new Set(
      ((told ?? []) as { job_id?: unknown }[]).map((row) => asString(row.job_id)),
    );
    for (const id of ids) {
      if (done.has(id)) continue;
      const result = await sendVisitDoneNotice(admin, {
        tenantId: p.tenantId,
        jobId: id,
        force: true,
      });
      // Covers the rest of the stop too; a later id in the same stop finds
      // every visit already claimed and returns already_sent.
      if (result.outcome === 'sent' || result.outcome === 'held') sent += 1;
    }
  } catch (err) {
    console.error('[sendWaitingVisitDoneNotices]', err);
  }
  return { sent };
}

/**
 * Rebuild and email the visit-done message after a text failed. `jobIds` is
 * the stop the text covered (messages.job_ids); the first is the primary
 * visit. Never throws.
 */
export async function sendVisitDoneEmailFallback(
  admin: SupabaseClient,
  p: { tenantId: string; jobId: string; jobIds?: string[] },
): Promise<{ sent: boolean; error?: string }> {
  try {
    const ids = [...new Set([p.jobId, ...(p.jobIds ?? [])])];
    const { data: claims, error: claimError } = await admin
      .from('notifications')
      .select('id, job_id, channel, status')
      .eq('tenant_id', p.tenantId)
      .eq('type', VISIT_DONE_NOTIFICATION_TYPE)
      .in('job_id', ids);

    if (claimError) return { sent: false, error: claimError.message };
    const claimRows = (claims ?? []) as {
      id?: unknown;
      job_id?: unknown;
      channel?: unknown;
      status?: unknown;
    }[];
    const primaryClaim = claimRows.find((row) => asString(row.job_id) === p.jobId);
    if (!primaryClaim) return { sent: false };
    if (primaryClaim.channel === 'email' && primaryClaim.status === 'sent') {
      return { sent: false };
    }
    const claimIds = claimRows
      .map((row) => asString(row.id))
      .filter((id): id is string => id != null);

    const { data: jobRows, error: jobError } = await admin
      .from('jobs')
      .select(JOB_COLUMNS)
      .eq('tenant_id', p.tenantId)
      .in('id', ids);
    if (jobError) return { sent: false, error: jobError.message };
    const byId = new Map(
      ((jobRows ?? []) as Record<string, unknown>[]).map((row) => [asString(row.id), row]),
    );
    const jobs = ids
      .map((id) => byId.get(id))
      .filter(
        (row): row is Record<string, unknown> =>
          row != null &&
          asString(row.status) === 'completed' &&
          asString(row.payment_status) !== 'waived',
      );
    const primary = jobs[0];
    if (!primary) return { sent: false, error: 'Visit not found' };

    const customerId = asString(primary.customer_id);
    const paymentStatus = stopPaymentStatus(
      jobs.map((row) => asString(row.payment_status) ?? ''),
    );
    if (!customerId || !paymentStatus) {
      return { sent: false, error: 'Visit is not done' };
    }

    const { data: customer, error: customerError } = await admin
      .from('customers')
      .select(
        'name, email, phone_e164, preferred_channel, payment_terms, bank_reference_hint',
      )
      .eq('id', customerId)
      .eq('tenant_id', p.tenantId)
      .maybeSingle();
    if (customerError || !customer) {
      return { sent: false, error: customerError?.message ?? 'Customer not found' };
    }

    const c = customer as Record<string, unknown>;
    const email = asString(c.email);
    if (!email) return { sent: false };

    const jobIds = jobs.map((row) => asString(row.id) as string);
    let invoiceId: string | undefined;
    let invoiceNumber: string | null = null;
    if (sendsInvoice(asString(c.payment_terms))) {
      const created = await createInvoiceCore(admin, {
        tenantId: p.tenantId,
        customerId,
        scope: 'visit',
        jobId: jobIds[0],
        jobIds,
      });
      if (created.success) {
        invoiceId = created.invoiceId;
        invoiceNumber = created.number;
      }
    }

    const assembled = await assembleVisitDone(admin, {
      tenantId: p.tenantId,
      customerId,
      customer: c,
      jobs,
      invoiceId,
      invoiceNumber,
      paymentStatus,
    });
    if (!assembled.ok) {
      return { sent: false, error: assembled.waived ? undefined : assembled.error };
    }

    const facts = assembled.assembled;
    const sent = await buildAndSendVisitDoneEmail(admin, {
      tenantId: p.tenantId,
      email,
      businessName: facts.businessName,
      logoUrl: facts.logoUrl,
      replyTo: facts.replyTo,
      msg: facts.msg,
      invoiceId,
      invoiceNumber,
    });

    for (const claimId of claimIds) {
      const { error: updateError } = await admin
        .from('notifications')
        .update({
          channel: 'email',
          provider: 'resend',
          status: sent.sent ? 'sent' : 'failed',
          subject: sent.subject,
          body: sent.html,
          sent_at: sent.sent ? new Date().toISOString() : null,
          failed_reason: sent.error ?? null,
          provider_message_id: sent.providerMessageId,
        })
        .eq('id', claimId);
      if (updateError) {
        console.error('[sendVisitDoneEmailFallback] log', updateError);
      }
    }

    return { sent: sent.sent, error: sent.error };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[sendVisitDoneEmailFallback]', p.jobId, err);
    return { sent: false, error };
  }
}

/**
 * Text or email after Mark as paid (dashboard action or phone LOG_PAYMENT).
 * Not called from Done — visit-done already covers cash/cheque on the stop.
 * Idempotent per payment via the payment_received unique index.
 */
export async function sendPaymentReceivedNotice(
  supabase: SupabaseClient,
  p: { tenantId: string; paymentId: string },
): Promise<NoticeResult> {
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
      .select('name, email, phone_e164, preferred_channel, bank_reference_hint, payment_thanks')
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
    // Payment thank-yous can be turned off for one customer or the whole business.
    if (c.payment_thanks === false) return { outcome: 'skipped_opted_out' };
    const thanksCtx = await getTenantMessagingContext(supabase, p.tenantId);
    if (thanksCtx?.settings?.payment_thanks_enabled === false) {
      return { outcome: 'skipped_opted_out' };
    }

    const email = asString(c.email);
    const phone = asString(c.phone_e164);
    if (!email && !isUkMobileE164(phone)) {
      return { outcome: 'skipped_no_channel' };
    }

    const admin = createAdminClient();
    const appliesToJobId = asString(row.applies_to_job_id);
    const { data: claimed, error: claimError } = await admin
      .from('notifications')
      .insert({
        tenant_id: p.tenantId,
        job_id: appliesToJobId,
        recipient_id: p.paymentId,
        type: PAYMENT_RECEIVED_NOTIFICATION_TYPE,
        channel: 'auto',
        recipient_type: 'customer',
        recipient_email: email ?? null,
        recipient_phone: phone ?? null,
        subject: '(pending)',
        body: '',
        status: 'pending',
        provider: null,
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

    const finish = async (patch: Record<string, unknown>, result: NoticeResult) => {
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
    const replyTo =
      company.email ?? (await replyToForTenant(supabase, p.tenantId));
    const messaging = await getTenantMessagingContext(supabase, p.tenantId);

    let remembered: RememberedEmail | null = null;
    const emailAttempt: EmailAttempt = async () => {
      const built = buildVisitDoneEmail(msg, {
        businessName,
        logoUrl: company.logoUrl,
      });
      let providerMessageId: string | null = null;
      let failedReason: string | null = null;
      try {
        const { resend } = await import('@/lib/resend');
        const { data, error } = await resend.emails.send({
          from: customerEmailFrom(businessName),
          to: email as string,
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
      remembered = {
        sent: !failedReason,
        error: failedReason ?? undefined,
        subject: built.subject,
        html: built.html,
        providerMessageId,
      };
      return { sent: remembered.sent, error: remembered.error };
    };

    let textBody = '';
    const { sendCustomerMessage } = await import('@/lib/messaging/send');
    const door = await sendCustomerMessage({
      tenantId: p.tenantId,
      customerId,
      kind: 'payment_received',
      dedupeKey: `payment_received:${p.paymentId}`,
      text: () => {
        textBody = paymentReceivedSms({
          brand: {
            businessName,
            contactPhone: messaging?.contactPhone ?? null,
          },
          amount,
          methodLabel: paymentMethodLabel(method),
          owedLeft: owed,
          payUrl,
          creditLeft: balance.creditAmount,
        });
        return textBody;
      },
      email: email ? emailAttempt : null,
      jobIds: appliesToJobId ? [appliesToJobId] : [],
    });

    const mapped = doorToNotice(door, remembered, textBody);
    if (!mapped.patch) return mapped.result;
    return finish(mapped.patch, mapped.result);
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
