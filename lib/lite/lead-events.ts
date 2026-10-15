import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildNewLeadEmail, type NewLeadEmailInput } from '@/lib/emails/lite-new-lead';
import { issueLeadToken } from '@/lib/lite/action-tokens';
import { buildTextContext, scheduleLeadText } from '@/lib/lite/texts';
import { firstName } from '@/lib/lite/text-templates';
import { litePaths, leadActionUrl } from '@/lib/navigation/lite-paths';
import { formatUkPhoneDisplay } from '@/lib/utils/phone';
import type { WidgetRow } from '@/lib/widget/guard';

/** Every leads column Lite uses. Steps 16 and 18 attach listeners below. */
export type LeadRow = {
  id: string;
  tenant_id: string;
  source: string;
  name: string;
  phone: string | null;
  email: string | null;
  job_description: string;
  quote_given: string;
  status: string;
  notes: string | null;
  widget_conversation_id: string | null;
  source_data: unknown;
  converted_customer_id: string | null;
  converted_job_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  client_id: string | null;
  phone_e164: string | null;
  postcode: string | null;
  preferred_days: string[];
  customer_note: string | null;
  job_summary: string | null;
  job_type_key: string | null;
  quote_kind: string | null;
  quote_amount: number | null;
  quote_min: number | null;
  quote_max: number | null;
  booking_status: string;
  agreed_amount: number | null;
  decided_at: string | null;
  decided_by: string | null;
  booked_for_date: string | null;
  booked_for_time: string | null;
  status_changed_at: string | null;
  follow_up_problem: string | null;
};

type Listener = (admin: SupabaseClient, lead: LeadRow) => Promise<void>;
type DecidedListener = (
  admin: SupabaseClient,
  lead: LeadRow,
  d: { decision: 'accepted' | 'declined'; tellCustomer: boolean; priceChanged: boolean },
) => Promise<void>;

const createdListeners: Listener[] = [];
const decidedListeners: DecidedListener[] = [];

function logFailure(leadId: string, hook: string): void {
  console.error('[lite lead]', leadId, hook);
}

export async function onLeadCreated(admin: SupabaseClient, lead: LeadRow): Promise<void> {
  for (const listener of createdListeners) {
    try {
      await listener(admin, lead);
    } catch {
      logFailure(lead.id, 'onLeadCreated');
    }
  }
}

export async function onBookingDecided(
  admin: SupabaseClient,
  lead: LeadRow,
  d: { decision: 'accepted' | 'declined'; tellCustomer: boolean; priceChanged: boolean },
): Promise<void> {
  for (const listener of decidedListeners) {
    try {
      await listener(admin, lead, d);
    } catch {
      logFailure(lead.id, 'onBookingDecided');
    }
  }
}

const WIDGET_COLUMNS =
  'id, tenant_id, business_name, trade, service_area, business_context, greeting, primary_colour, allowed_domains, owner_mobile_e164, sign_off_name, follow_up_enabled, text_me_too, notification_email';

function widgetFrom(row: unknown): WidgetRow | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.tenant_id !== 'string') return null;
  if (typeof r.business_name !== 'string' || typeof r.trade !== 'string') return null;
  if (typeof r.follow_up_enabled !== 'boolean' || typeof r.text_me_too !== 'boolean') return null;
  if (typeof r.notification_email !== 'string') return null;
  const domains = Array.isArray(r.allowed_domains)
    ? r.allowed_domains.filter((domain): domain is string => typeof domain === 'string')
    : [];
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    business_name: r.business_name,
    trade: r.trade,
    service_area: typeof r.service_area === 'string' ? r.service_area : '',
    business_context: typeof r.business_context === 'string' ? r.business_context : '',
    greeting: typeof r.greeting === 'string' ? r.greeting : '',
    primary_colour: typeof r.primary_colour === 'string' ? r.primary_colour : '',
    allowed_domains: domains,
    owner_mobile_e164: typeof r.owner_mobile_e164 === 'string' ? r.owner_mobile_e164 : null,
    sign_off_name: typeof r.sign_off_name === 'string' ? r.sign_off_name : null,
    follow_up_enabled: r.follow_up_enabled,
    text_me_too: r.text_me_too,
    notification_email: r.notification_email,
  };
}

async function loadWidget(admin: SupabaseClient, lead: LeadRow): Promise<WidgetRow | null> {
  let query = admin.from('widget_clients').select(WIDGET_COLUMNS).eq('tenant_id', lead.tenant_id);
  if (lead.client_id) query = query.eq('id', lead.client_id);
  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  const widget = widgetFrom(data);
  if (!widget || widget.tenant_id !== lead.tenant_id) return null;
  return widget;
}

createdListeners.push(async (admin, lead) => {
  if (!lead.phone_e164) return;
  if (lead.decided_by === 'auto') return;
  const widget = await loadWidget(admin, lead);
  if (!widget) {
    console.error('[lite lead]', lead.id, 'text widget missing');
    return;
  }
  await scheduleLeadText(admin, {
    tenantId: lead.tenant_id,
    leadId: lead.id,
    kind: 'follow_up',
    to: lead.phone_e164,
    context: buildTextContext(lead, widget, 'follow_up'),
    dedupeKey: `follow_up:${lead.id}`,
  });
});

function appBase(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, '');
}

function alertState(lead: LeadRow): NewLeadEmailInput['state'] {
  if (lead.booking_status === 'requested') return 'booking_request';
  if (lead.booking_status === 'accepted' && lead.decided_by === 'auto') return 'auto_accepted';
  return 'enquiry';
}

function alertQuote(lead: LeadRow): NewLeadEmailInput['quote'] {
  if (lead.quote_kind === 'firm' && typeof lead.quote_amount === 'number') {
    return { kind: 'firm', amount: lead.quote_amount };
  }
  if (lead.quote_kind === 'guide' && typeof lead.quote_min === 'number' && typeof lead.quote_max === 'number') {
    return { kind: 'guide', min: lead.quote_min, max: lead.quote_max };
  }
  if (lead.quote_kind === 'visit') return { kind: 'visit' };
  return null;
}

function errorName(err: unknown): string {
  if (err instanceof Error && err.name) return err.name;
  if (err && typeof err === 'object' && 'name' in err && typeof err.name === 'string') return err.name;
  return 'Error';
}

async function sendNewLeadAlert(
  to: string,
  lead: LeadRow,
  built: { subject: string; html: string; text: string },
): Promise<void> {
  const address = to.trim();
  if (!address) {
    console.error('[lite lead]', lead.id, 'email');
    return;
  }
  const reply = lead.email?.trim() ?? '';
  try {
    const { resend, FROM_EMAIL } = await import('@/lib/resend');
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: address,
      subject: built.subject,
      html: built.html,
      text: built.text,
      ...(reply !== '' && !/[\r\n]/.test(reply) ? { replyTo: reply } : {}),
    });
    if (error) console.error('[lite lead]', lead.id, 'email', errorName(error));
  } catch (err) {
    console.error('[lite lead]', lead.id, 'email', errorName(err));
  }
}

createdListeners.push(async (admin, lead) => {
  const widget = await loadWidget(admin, lead);
  if (!widget) {
    console.error('[lite lead]', lead.id, 'alert widget missing');
    return;
  }
  const base = appBase();
  if (!base) {
    console.error('[lite lead]', lead.id, 'url');
    return;
  }
  const state = alertState(lead);
  let actionLink: string | null = null;
  if (state === 'booking_request') {
    const raw = await issueLeadToken(admin, { tenantId: lead.tenant_id, leadId: lead.id });
    actionLink = raw ? leadActionUrl(raw) : null;
  }
  const leadPageUrl = `${base}${litePaths.lead(lead.id)}`;
  const mobile = lead.phone_e164 ? formatUkPhoneDisplay(lead.phone_e164) : '';
  const built = buildNewLeadEmail({
    businessName: widget.business_name,
    firstName: firstName(lead.name),
    fullName: lead.name,
    mobileDisplay: mobile === '' ? null : mobile,
    email: lead.email,
    postcode: lead.postcode,
    preferredDays: lead.preferred_days ?? [],
    note: lead.customer_note,
    jobSummary: lead.job_summary,
    quote: alertQuote(lead),
    state,
    actionLink,
    leadPageUrl,
  });
  await sendNewLeadAlert(widget.notification_email, lead, built);
  const ownerMobile = widget.owner_mobile_e164?.trim() ?? '';
  if (!widget.text_me_too || ownerMobile === '') return;
  await scheduleLeadText(admin, {
    tenantId: lead.tenant_id,
    leadId: lead.id,
    kind: 'owner_alert',
    to: ownerMobile,
    context: { ...buildTextContext(lead, widget, 'owner_alert'), link: actionLink ?? leadPageUrl },
    dedupeKey: `owner_alert:new:${lead.id}`,
  });
});

decidedListeners.push(async (admin, lead, d) => {
  const accepted = d.decision === 'accepted';
  if (!accepted && !d.tellCustomer) return;
  const widget = await loadWidget(admin, lead);
  if (!widget) {
    console.error('[lite lead]', lead.id, 'text widget missing');
    return;
  }
  const kind = accepted ? 'booking_accepted' : 'booking_declined';
  await scheduleLeadText(admin, {
    tenantId: lead.tenant_id,
    leadId: lead.id,
    kind,
    to: lead.phone_e164,
    context: buildTextContext(lead, widget, kind, { priceChanged: d.priceChanged }),
    dedupeKey: `${kind}:${lead.id}`,
  });
});
