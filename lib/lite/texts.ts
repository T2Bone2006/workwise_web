import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { ENTITLED_STATUSES } from '@/lib/data/tenant-products';
import { TEXT_ALLOWANCE_PER_MONTH } from '@/lib/messaging/credits';
import { countSegments, toGsm7 } from '@/lib/messaging/gsm';
import { londonMonth } from '@/lib/messaging/london-time';
import { activeProvider, sendText } from '@/lib/messaging/provider';
import { isOptedOut } from '@/lib/messaging/threads';
import { buildPlainCustomerEmail } from '@/lib/emails/plain-customer';
import { draftLeadText } from '@/lib/lite/draft-text';
import type { LeadRow } from '@/lib/lite/lead-events';
import {
  fallbackText,
  firstName,
  nextSendTime,
  type TextContext,
  type TextKind,
} from '@/lib/lite/text-templates';
import { formatUkPhoneDisplay } from '@/lib/utils/phone';
import type { WidgetRow } from '@/lib/widget/guard';

const DUE_LIMIT = 50;
const STUCK_MS = 10 * 60 * 1000;

type Outcome = 'sent' | 'emailed' | 'skipped' | 'failed';

type TextRow = {
  id: string;
  tenant_id: string;
  lead_id: string;
  kind: TextKind;
  to_address: string | null;
  context: unknown;
};

type LeadSend = {
  id: string;
  tenant_id: string;
  client_id: string | null;
  email: string | null;
  booking_status: string;
};

type WidgetSend = {
  tenant_id: string;
  business_name: string;
  follow_up_enabled: boolean;
};

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

function asKind(value: unknown): TextKind | null {
  if (
    value === 'follow_up' ||
    value === 'booking_accepted' ||
    value === 'booking_declined' ||
    value === 'owner_alert'
  ) {
    return value;
  }
  return null;
}

function customerKind(kind: TextKind): kind is Exclude<TextKind, 'owner_alert'> {
  return kind !== 'owner_alert';
}

function shortError(message: string): string {
  return message.replace(/\s+/g, ' ').trim().slice(0, 180);
}

function quoteKind(value: string | null): TextContext['quote_kind'] {
  if (value === 'firm' || value === 'guide' || value === 'visit') return value;
  return null;
}

function amountsFor(lead: LeadRow, kind: TextKind): number[] {
  if (kind === 'follow_up') {
    return lead.quote_kind === 'firm' && lead.quote_amount != null ? [lead.quote_amount] : [];
  }
  if (kind === 'booking_accepted') {
    return lead.agreed_amount != null ? [lead.agreed_amount] : [];
  }
  // Not an AI draft: the amounts are only so the fixed owner-alert text can show the price.
  if (kind === 'owner_alert') {
    if (lead.quote_kind === 'firm' && lead.quote_amount != null) return [lead.quote_amount];
    if (lead.quote_kind === 'guide' && lead.quote_min != null && lead.quote_max != null) {
      return [lead.quote_min, lead.quote_max];
    }
  }
  return [];
}

export function buildTextContext(
  lead: LeadRow,
  widget: WidgetRow,
  kind: TextKind,
  extra?: { priceChanged?: boolean },
): TextContext {
  const mobile = widget.owner_mobile_e164 ? formatUkPhoneDisplay(widget.owner_mobile_e164) : '';
  const sign = widget.sign_off_name?.trim() || widget.business_name;
  return {
    first_name: firstName(lead.name),
    business_name: widget.business_name,
    sign_off: sign,
    trade: widget.trade,
    owner_mobile_display: mobile === '' ? null : mobile,
    job_summary: lead.job_summary,
    quote_kind: quoteKind(lead.quote_kind),
    allowed_amounts: amountsFor(lead, kind),
    booking_requested: lead.booking_status === 'requested',
    price_changed: extra?.priceChanged ?? false,
    preferred_days: lead.preferred_days ?? [],
    ...(kind === 'owner_alert' && lead.booking_status === 'accepted' && lead.decided_by === 'auto'
      ? { auto_accepted: true }
      : {}),
  };
}

function asContext(raw: unknown, businessName: string): TextContext {
  const empty: TextContext = {
    first_name: 'there',
    business_name: businessName,
    sign_off: businessName,
    trade: '',
    owner_mobile_display: null,
    job_summary: null,
    quote_kind: null,
    allowed_amounts: [],
    booking_requested: false,
    price_changed: false,
    preferred_days: [],
  };
  if (!raw || typeof raw !== 'object') return empty;
  const c = raw as Record<string, unknown>;
  if (typeof c.sign_off !== 'string' || typeof c.business_name !== 'string' || typeof c.first_name !== 'string') {
    return empty;
  }
  const amounts = Array.isArray(c.allowed_amounts)
    ? c.allowed_amounts.filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
    : [];
  const days = Array.isArray(c.preferred_days)
    ? c.preferred_days.filter((day): day is string => typeof day === 'string')
    : [];
  return {
    first_name: c.first_name,
    business_name: c.business_name,
    sign_off: c.sign_off,
    trade: typeof c.trade === 'string' ? c.trade : '',
    owner_mobile_display: typeof c.owner_mobile_display === 'string' ? c.owner_mobile_display : null,
    job_summary: typeof c.job_summary === 'string' ? c.job_summary : null,
    quote_kind: quoteKind(typeof c.quote_kind === 'string' ? c.quote_kind : null),
    allowed_amounts: amounts,
    booking_requested: c.booking_requested === true,
    price_changed: c.price_changed === true,
    preferred_days: days,
    ...(typeof c.link === 'string' ? { link: c.link } : {}),
    ...(c.auto_accepted === true ? { auto_accepted: true } : {}),
    ...(typeof c.reply_text === 'string' ? { reply_text: c.reply_text } : {}),
    ...(typeof c.customer_mobile_display === 'string'
      ? { customer_mobile_display: c.customer_mobile_display }
      : {}),
  };
}

function asTextRow(raw: unknown): TextRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const kind = asKind(row.kind);
  if (typeof row.id !== 'string' || typeof row.tenant_id !== 'string' || typeof row.lead_id !== 'string' || !kind) {
    return null;
  }
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    lead_id: row.lead_id,
    kind,
    to_address: typeof row.to_address === 'string' ? row.to_address : null,
    context: row.context,
  };
}

function asLeadSend(raw: unknown): LeadSend | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.tenant_id !== 'string') return null;
  const email = typeof row.email === 'string' ? row.email.trim() : '';
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    client_id: typeof row.client_id === 'string' ? row.client_id : null,
    email: email === '' ? null : email,
    booking_status: typeof row.booking_status === 'string' ? row.booking_status : 'none',
  };
}

function asWidgetSend(raw: unknown): WidgetSend | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.tenant_id !== 'string' || typeof row.business_name !== 'string') return null;
  if (typeof row.follow_up_enabled !== 'boolean') return null;
  return {
    tenant_id: row.tenant_id,
    business_name: row.business_name,
    follow_up_enabled: row.follow_up_enabled,
  };
}

export async function scheduleLeadText(
  admin: SupabaseClient,
  p: {
    tenantId: string;
    leadId: string;
    kind: TextKind;
    to: string | null;
    context: TextContext;
    dedupeKey: string;
    now?: Date;
  },
): Promise<{ outcome: 'scheduled' | 'duplicate' | 'skipped'; id?: string }> {
  const now = p.now ?? new Date();
  const to = typeof p.to === 'string' ? p.to.trim() : '';
  const row: Record<string, unknown> = {
    tenant_id: p.tenantId,
    lead_id: p.leadId,
    kind: p.kind,
    direction: 'outbound',
    context: p.context,
    dedupe_key: p.dedupeKey,
    provider: activeProvider(),
  };
  if (!to) {
    row.status = 'skipped';
    row.skip_reason = 'no_mobile';
  } else {
    row.status = 'scheduled';
    row.to_address = to;
    row.send_after = nextSendTime(now, p.kind).toISOString();
  }

  const { data, error } = await admin.from('lite_texts').insert(row).select('id').maybeSingle();
  if (error) {
    if (isUniqueViolation(error)) return { outcome: 'duplicate' };
    throw new Error('schedule_failed');
  }
  const id = (data as { id?: unknown } | null)?.id;
  const outcome = to ? 'scheduled' : 'skipped';
  return typeof id === 'string' ? { outcome, id } : { outcome };
}

async function mark(
  admin: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await admin.from('lite_texts').update(patch).eq('id', id).eq('status', 'sending');
  if (error) console.error('[lite text]', id, 'update');
}

async function setFollowUpProblem(
  admin: SupabaseClient,
  row: TextRow,
  problem: 'out_of_texts' | 'opted_out' | 'failed' | 'stuck',
): Promise<void> {
  if (row.kind !== 'follow_up') return;
  try {
    const { error } = await admin
      .from('leads')
      .update({ follow_up_problem: problem })
      .eq('id', row.lead_id)
      .eq('tenant_id', row.tenant_id);
    if (error) console.error('[lite text]', row.lead_id, 'follow_up_problem');
  } catch {
    console.error('[lite text]', row.lead_id, 'follow_up_problem');
  }
}

async function refundCredits(
  admin: SupabaseClient,
  p: { tenantId: string; segments: number; from: string; month: string },
): Promise<void> {
  if (p.from !== 'allowance' && p.from !== 'pack') return;
  const { error } = await admin.rpc('refund_text_credits', {
    p_tenant_id: p.tenantId,
    p_segments: p.segments,
    p_from: p.from,
    p_month: p.month,
  });
  if (error) console.error('[lite text] refund');
}

async function loadLead(admin: SupabaseClient, row: TextRow): Promise<LeadSend | null> {
  const { data, error } = await admin
    .from('leads')
    .select('id, tenant_id, client_id, email, booking_status')
    .eq('id', row.lead_id)
    .eq('tenant_id', row.tenant_id)
    .maybeSingle();
  if (error || !data) return null;
  return asLeadSend(data);
}

async function loadWidget(admin: SupabaseClient, lead: LeadSend): Promise<WidgetSend | null> {
  let query = admin
    .from('widget_clients')
    .select('tenant_id, business_name, follow_up_enabled')
    .eq('tenant_id', lead.tenant_id);
  if (lead.client_id) query = query.eq('id', lead.client_id);
  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  const widget = asWidgetSend(data);
  if (!widget || widget.tenant_id !== lead.tenant_id) return null;
  return widget;
}

async function sendEnquiryEmail(
  to: string,
  businessName: string,
  body: string,
): Promise<boolean> {
  const subject = `${businessName}: your enquiry`;
  const built = buildPlainCustomerEmail({
    businessName,
    logoUrl: null,
    subject,
    text: body,
  });
  try {
    const { resend, FROM_EMAIL } = await import('@/lib/resend');
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: built.subject,
      html: built.html,
      text: built.text,
    });
    return !error;
  } catch {
    return false;
  }
}

async function deliver(admin: SupabaseClient, row: TextRow, now: Date): Promise<Outcome> {
  let credits: { from: string; segments: number; month: string } | null = null;
  let providerCalled = false;
  try {
    const lead = await loadLead(admin, row);
    const widget = lead ? await loadWidget(admin, lead) : null;
    if (!lead || !widget) {
      await mark(admin, row.id, { status: 'failed', error: 'lead gone' });
      return 'failed';
    }

    const to = row.to_address?.trim() ?? '';
    const decided = lead.booking_status === 'accepted' || lead.booking_status === 'declined';
    if (row.kind === 'follow_up' && decided) {
      await mark(admin, row.id, { status: 'skipped', skip_reason: 'lead_closed' });
      return 'skipped';
    }
    if (customerKind(row.kind) && !widget.follow_up_enabled) {
      await mark(admin, row.id, { status: 'skipped', skip_reason: 'follow_ups_off' });
      return 'skipped';
    }
    if (!to || (await isOptedOut(admin, to))) {
      await mark(admin, row.id, { status: 'skipped', skip_reason: to ? 'opted_out' : 'no_mobile' });
      if (to) await setFollowUpProblem(admin, row, 'opted_out');
      return 'skipped';
    }

    const context = asContext(row.context, widget.business_name);
    const drafted = customerKind(row.kind)
      ? await draftLeadText(admin, { tenantId: row.tenant_id, textId: row.id, kind: row.kind, context })
      : { body: fallbackText(row.kind, context), draftedBy: 'template' as const };
    const body = toGsm7(drafted.body);
    const segments = countSegments(body).segments;
    if (segments < 1 || segments > 3) {
      await mark(admin, row.id, { status: 'failed', error: 'failed' });
      return 'failed';
    }

    const month = londonMonth(now);
    const { data: billedFrom, error: creditError } = await admin.rpc('claim_text_credits', {
      p_tenant_id: row.tenant_id,
      p_segments: segments,
      p_allowance: TEXT_ALLOWANCE_PER_MONTH,
    });
    if (creditError) {
      await mark(admin, row.id, { status: 'failed', error: 'credits' });
      return 'failed';
    }
    const from = typeof billedFrom === 'string' ? billedFrom : String(billedFrom ?? '');
    if (from === 'none') {
      if (customerKind(row.kind) && lead.email) {
        const emailed = await sendEnquiryEmail(lead.email, widget.business_name, body);
        if (emailed) {
          await mark(admin, row.id, {
            status: 'emailed',
            sent_at: now.toISOString(),
            body,
            segments,
            drafted_by: drafted.draftedBy,
          });
          return 'emailed';
        }
      }
      await mark(admin, row.id, { status: 'skipped', skip_reason: 'no_texts_left' });
      await setFollowUpProblem(admin, row, 'out_of_texts');
      return 'skipped';
    }
    if (from !== 'allowance' && from !== 'pack') {
      await mark(admin, row.id, { status: 'failed', error: 'credits' });
      return 'failed';
    }
    credits = { from, segments, month };

    providerCalled = true;
    const sent = await sendText({ to, body, clientReference: row.id });
    if (!sent.ok) {
      await refundCredits(admin, { tenantId: row.tenant_id, segments, from, month });
      credits = null;
      await mark(admin, row.id, { status: 'failed', error: shortError(sent.error) || 'failed' });
      await setFollowUpProblem(admin, row, 'failed');
      return 'failed';
    }

    await mark(admin, row.id, {
      status: 'sent',
      sent_at: now.toISOString(),
      body,
      segments,
      billed_from: from,
      billed_month: month,
      provider_message_id: sent.providerMessageId,
      drafted_by: drafted.draftedBy,
      provider: sent.provider,
    });
    return 'sent';
  } catch (err) {
    if (credits && !providerCalled) {
      await refundCredits(admin, { tenantId: row.tenant_id, ...credits });
    }
    const name = err instanceof Error && err.name ? err.name : 'Error';
    await mark(admin, row.id, { status: 'failed', error: name.slice(0, 80) });
    return 'failed';
  }
}

/** Businesses with an entitled Lite row. Throws when the read fails (caller sends nothing). */
async function entitledLiteTenantIds(admin: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await admin
    .from('subscriptions')
    .select('tenant_id')
    .eq('product', 'lite')
    .in('status', [...ENTITLED_STATUSES]);
  if (error) {
    console.error('[sendDueLeadTexts] lite tenants', error.message);
    throw new Error('lite_tenants');
  }
  const ids = new Set<string>();
  for (const row of data ?? []) {
    const tenantId = (row as { tenant_id?: unknown }).tenant_id;
    if (typeof tenantId === 'string') ids.add(tenantId);
  }
  return ids;
}

export async function sendDueLeadTexts(
  admin: SupabaseClient,
  now: Date,
  limit = DUE_LIMIT,
): Promise<{ claimed: number; sent: number; emailed: number; skipped: number; failed: number }> {
  const totals = { claimed: 0, sent: 0, emailed: 0, skipped: 0, failed: 0 };
  let entitled: Set<string>;
  try {
    entitled = await entitledLiteTenantIds(admin);
  } catch (err) {
    console.error('[sendDueLeadTexts] tenant list', err instanceof Error ? err.message : 'error');
    return totals;
  }

  const { data, error } = await admin
    .from('lite_texts')
    .select('id, tenant_id')
    .eq('status', 'scheduled')
    .lte('send_after', now.toISOString())
    .order('send_after', { ascending: true })
    .limit(limit);
  if (error) throw new Error('due_failed');
  const due = Array.isArray(data)
    ? data.flatMap((row) => {
        const id = (row as { id?: unknown }).id;
        const tenantId = (row as { tenant_id?: unknown }).tenant_id;
        if (typeof id !== 'string' || typeof tenantId !== 'string') return [];
        return [{ id, tenantId }];
      })
    : [];

  for (const item of due) {
    if (!entitled.has(item.tenantId)) {
      const { data: skipped, error: skipError } = await admin
        .from('lite_texts')
        .update({ status: 'skipped', skip_reason: 'plan_ended' })
        .eq('id', item.id)
        .eq('status', 'scheduled')
        .select('id');
      if (skipError) {
        console.error('[lite text]', item.id, 'plan_ended');
        continue;
      }
      if (Array.isArray(skipped) && skipped.length > 0) totals.skipped += 1;
      continue;
    }
    const id = item.id;
    const { data: claimed, error: claimError } = await admin
      .from('lite_texts')
      .update({ status: 'sending', claimed_at: now.toISOString() })
      .eq('id', id)
      .eq('status', 'scheduled')
      .lte('send_after', now.toISOString())
      .select('*');
    if (claimError) {
      console.error('[lite text]', id, 'claim');
      continue;
    }
    const row = Array.isArray(claimed) ? asTextRow(claimed[0]) : null;
    if (!row) continue;
    totals.claimed += 1;
    const outcome = await deliver(admin, row, now);
    totals[outcome] += 1;
  }
  return totals;
}

export async function failStuckLeadTexts(admin: SupabaseClient, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - STUCK_MS).toISOString();
  const { data, error } = await admin
    .from('lite_texts')
    .update({ status: 'failed', error: 'stuck' })
    .eq('status', 'sending')
    .lt('claimed_at', cutoff)
    .select('id, lead_id, tenant_id, kind');
  if (error) throw new Error('stuck_failed');
  const rows = Array.isArray(data) ? data : [];
  for (const raw of rows) {
    const row = asTextRow(raw);
    if (row) await setFollowUpProblem(admin, row, 'stuck');
  }
  return rows.length;
}
