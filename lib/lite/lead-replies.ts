import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildLeadReplyEmail } from '@/lib/emails/lite-lead-reply';
import type { LeadRow } from '@/lib/lite/lead-events';
import { asLead } from '@/lib/lite/leads-core';
import { buildTextContext, scheduleLeadText } from '@/lib/lite/texts';
import { firstName } from '@/lib/lite/text-templates';
import { litePaths } from '@/lib/navigation/lite-paths';
import { formatUkPhoneDisplay } from '@/lib/utils/phone';
import type { WidgetRow } from '@/lib/widget/guard';

export type LeadReplyResult = { handled: false } | { handled: true; duplicate: boolean };

const DAY_MS = 24 * 60 * 60 * 1000;
const MATCH_DAYS = 30;
const REPLY_CHARS = 100;
const MATCH_KINDS = ['follow_up', 'booking_accepted', 'booking_declined'] as const;

const WIDGET_COLUMNS =
  'id, tenant_id, business_name, trade, owner_mobile_e164, sign_off_name, follow_up_enabled, text_me_too, notification_email';

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

function leadPageUrl(leadId: string): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) return null;
  return `${raw.replace(/\/+$/, '')}${litePaths.lead(leadId)}`;
}

function digitsHref(display: string, scheme: 'tel' | 'sms'): string | null {
  const digits = display.replace(/[^\d+]/g, '');
  return digits ? `${scheme}:${digits}` : null;
}

function firstChars(body: string, max: number): string {
  return [...body].slice(0, max).join('');
}

function asWidget(row: unknown): WidgetRow | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.tenant_id !== 'string') return null;
  if (typeof r.business_name !== 'string' || typeof r.text_me_too !== 'boolean') return null;
  if (typeof r.notification_email !== 'string') return null;
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    business_name: r.business_name,
    trade: typeof r.trade === 'string' ? r.trade : '',
    service_area: '',
    business_context: '',
    greeting: '',
    primary_colour: '',
    allowed_domains: [],
    owner_mobile_e164: typeof r.owner_mobile_e164 === 'string' ? r.owner_mobile_e164 : null,
    sign_off_name: typeof r.sign_off_name === 'string' ? r.sign_off_name : null,
    follow_up_enabled: r.follow_up_enabled === true,
    text_me_too: r.text_me_too,
    notification_email: r.notification_email,
  };
}

function logLead(leadId: string, what: string): void {
  console.error('[lite lead]', leadId, what);
}

async function loadLead(admin: SupabaseClient, tenantId: string, leadId: string): Promise<LeadRow | null> {
  const { data, error } = await admin
    .from('leads')
    .select(
      'id, tenant_id, name, phone, phone_e164, client_id, job_summary, quote_kind, quote_amount, quote_min, quote_max, booking_status, preferred_days, decided_by, agreed_amount',
    )
    .eq('id', leadId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error || !data) return null;
  return asLead(data);
}

async function loadWidget(admin: SupabaseClient, lead: LeadRow): Promise<WidgetRow | null> {
  let query = admin.from('widget_clients').select(WIDGET_COLUMNS).eq('tenant_id', lead.tenant_id);
  if (lead.client_id) query = query.eq('id', lead.client_id);
  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  const widget = asWidget(data);
  if (!widget || widget.tenant_id !== lead.tenant_id) return null;
  return widget;
}

async function sendReplyEmail(
  to: string,
  leadId: string,
  built: { subject: string; html: string; text: string },
): Promise<void> {
  const address = to.trim();
  if (address === '') {
    logLead(leadId, 'email');
    return;
  }
  try {
    const { resend, FROM_EMAIL } = await import('@/lib/resend');
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: address,
      subject: built.subject,
      html: built.html,
      text: built.text,
    });
    if (error) logLead(leadId, 'email');
  } catch {
    logLead(leadId, 'email');
  }
}

async function notify(
  admin: SupabaseClient,
  match: { tenantId: string; leadId: string },
  insertedId: string,
  p: { from: string; body: string; keyword: 'opt_out' | 'opt_in' | null; at: Date },
): Promise<void> {
  const lead = await loadLead(admin, match.tenantId, match.leadId);
  const widget = lead ? await loadWidget(admin, lead) : null;
  if (!lead || !widget) {
    logLead(match.leadId, 'reply');
    return;
  }

  const mobile = formatUkPhoneDisplay(p.from);
  const mobileDisplay = mobile === '' ? null : mobile;
  const page = leadPageUrl(lead.id);
  if (!page) logLead(lead.id, 'url');
  const built = buildLeadReplyEmail({
    firstName: firstName(lead.name),
    fullName: lead.name.trim() || firstName(lead.name),
    body: p.body,
    mobileDisplay,
    telHref: mobileDisplay ? digitsHref(mobileDisplay, 'tel') : null,
    smsHref: mobileDisplay ? digitsHref(mobileDisplay, 'sms') : null,
    leadPageUrl: page,
    optedOut: p.keyword === 'opt_out',
  });
  await sendReplyEmail(widget.notification_email, lead.id, built);

  const ownerMobile = widget.owner_mobile_e164?.trim() ?? '';
  if (!widget.text_me_too || ownerMobile === '' || p.keyword != null) return;
  try {
    await scheduleLeadText(admin, {
      tenantId: lead.tenant_id,
      leadId: lead.id,
      kind: 'owner_alert',
      to: ownerMobile,
      now: p.at,
      context: {
        ...buildTextContext(lead, widget, 'owner_alert'),
        reply_text: firstChars(p.body, REPLY_CHARS),
        ...(mobileDisplay ? { customer_mobile_display: mobileDisplay } : {}),
      },
      dedupeKey: `owner_alert:reply:${insertedId}`,
    });
  } catch {
    logLead(lead.id, 'owner text');
  }
}

/**
 * A reply to a Lite text from the last 30 days. Returns handled: false when
 * this number was not texted that way, and the caller keeps today's unknown-number path.
 */
export async function handleLeadReply(
  admin: SupabaseClient,
  p: {
    from: string;
    body: string;
    providerMessageId: string | null;
    keyword: 'opt_out' | 'opt_in' | null;
    at: Date;
  },
): Promise<LeadReplyResult> {
  const since = new Date(p.at.getTime() - MATCH_DAYS * DAY_MS).toISOString();
  const { data, error } = await admin
    .from('lite_texts')
    .select('tenant_id, lead_id')
    .eq('direction', 'outbound')
    .eq('to_address', p.from)
    .in('kind', [...MATCH_KINDS])
    .eq('status', 'sent')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error('Could not match this reply to a lead.');
  if (!data || typeof data !== 'object') return { handled: false };
  const row = data as { tenant_id?: unknown; lead_id?: unknown };
  if (typeof row.tenant_id !== 'string' || typeof row.lead_id !== 'string') {
    throw new Error('Could not match this reply to a lead.');
  }

  const { data: inserted, error: insertError } = await admin
    .from('lite_texts')
    .insert({
      tenant_id: row.tenant_id,
      lead_id: row.lead_id,
      kind: 'reply_in',
      direction: 'inbound',
      from_address: p.from,
      body: p.body,
      status: 'received',
      provider_message_id: p.providerMessageId,
    })
    .select('id')
    .maybeSingle();
  if (insertError) {
    if (isUniqueViolation(insertError)) return { handled: true, duplicate: true };
    throw new Error('Could not store this reply.');
  }
  const insertedId = inserted && typeof inserted === 'object' ? (inserted as { id?: unknown }).id : null;
  if (typeof insertedId !== 'string') throw new Error('Could not store this reply.');

  try {
    await notify(admin, { tenantId: row.tenant_id, leadId: row.lead_id }, insertedId, p);
  } catch {
    logLead(row.lead_id, 'reply');
  }
  return { handled: true, duplicate: false };
}
