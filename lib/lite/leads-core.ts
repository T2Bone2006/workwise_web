import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { onBookingDecided, onLeadCreated, type LeadRow } from '@/lib/lite/lead-events';
import type { LeadStatus, WidgetLeadValues } from '@/lib/validations/lite/lead';
import { loadWidgetProfile } from '@/lib/widget/conversation';
import type { WidgetRow } from '@/lib/widget/guard';
import type { GuardedQuote } from '@/lib/widget/turn-schema';
import { formatUkPhoneDisplay, normalizeUkPhoneE164 } from '@/lib/utils/phone';

const MOBILE_RE = /^\+447\d{9}$/;
const POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export type Ymd = string;

type FieldError = {
  ok: false;
  field?: 'mobile' | 'postcode' | 'email' | 'preferredDays';
  error: 'invalid' | 'no_conversation' | 'save_failed';
};

function pounds(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  if (Number.isInteger(rounded)) return `£${rounded}`;
  return `£${rounded.toFixed(2)}`;
}

export function quoteGivenText(q: {
  kind?: string | null;
  amount?: number | null;
  min?: number | null;
  max?: number | null;
}): string {
  if (q.kind === 'firm' && typeof q.amount === 'number' && Number.isFinite(q.amount)) return pounds(q.amount);
  if (
    q.kind === 'guide' &&
    typeof q.min === 'number' &&
    typeof q.max === 'number' &&
    Number.isFinite(q.min) &&
    Number.isFinite(q.max)
  ) {
    return `${pounds(q.min)}–${pounds(q.max)}`;
  }
  if (q.kind === 'visit') return 'Free look-and-quote visit';
  return '';
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function asLead(raw: unknown): LeadRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.tenant_id !== 'string') return null;
  const days = Array.isArray(row.preferred_days) ? row.preferred_days.filter((day) => typeof day === 'string') : [];
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    source: typeof row.source === 'string' ? row.source : 'widget',
    name: typeof row.name === 'string' ? row.name : '',
    phone: asText(row.phone),
    email: asText(row.email),
    job_description: typeof row.job_description === 'string' ? row.job_description : '',
    quote_given: typeof row.quote_given === 'string' ? row.quote_given : '',
    status: typeof row.status === 'string' ? row.status : 'new',
    notes: asText(row.notes),
    widget_conversation_id: asText(row.widget_conversation_id),
    source_data: row.source_data ?? {},
    converted_customer_id: asText(row.converted_customer_id),
    converted_job_id: asText(row.converted_job_id),
    created_at: asText(row.created_at),
    updated_at: asText(row.updated_at),
    client_id: asText(row.client_id),
    phone_e164: asText(row.phone_e164),
    postcode: asText(row.postcode),
    preferred_days: days as string[],
    customer_note: asText(row.customer_note),
    job_summary: asText(row.job_summary),
    job_type_key: asText(row.job_type_key),
    quote_kind: asText(row.quote_kind),
    quote_amount: asNumber(row.quote_amount),
    quote_min: asNumber(row.quote_min),
    quote_max: asNumber(row.quote_max),
    booking_status: typeof row.booking_status === 'string' ? row.booking_status : 'none',
    agreed_amount: asNumber(row.agreed_amount),
    decided_at: asText(row.decided_at),
    decided_by: asText(row.decided_by),
    booked_for_date: asText(row.booked_for_date),
    booked_for_time: asText(row.booked_for_time),
    status_changed_at: asText(row.status_changed_at),
    follow_up_problem: asText(row.follow_up_problem),
  };
}

function normalisePostcode(raw: string): string | null {
  const compact = raw.toUpperCase().replace(/\s+/g, '');
  if (compact.length < 5 || compact.length > 7) return null;
  const formatted = `${compact.slice(0, -3)} ${compact.slice(-3)}`;
  if (!POSTCODE_RE.test(formatted)) return null;
  return formatted;
}

function cleanDays(days: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const day of days) {
    if (seen.has(day)) continue;
    seen.add(day);
    unique.push(day);
  }
  if (unique.includes('any')) return ['any'];
  return unique;
}

function asQuote(raw: unknown): GuardedQuote | null {
  if (!raw || typeof raw !== 'object') return null;
  const quote = raw as Record<string, unknown>;
  const summary = typeof quote.summary === 'string' ? quote.summary.trim().slice(0, 200) : '';
  const key = typeof quote.jobTypeKey === 'string' && quote.jobTypeKey !== '' ? quote.jobTypeKey : null;
  if (quote.kind === 'firm' && typeof quote.amount === 'number' && key) {
    return { kind: 'firm', jobTypeKey: key, amount: quote.amount, summary };
  }
  if (quote.kind === 'guide' && typeof quote.min === 'number' && typeof quote.max === 'number' && key) {
    return { kind: 'guide', jobTypeKey: key, min: quote.min, max: quote.max, summary };
  }
  if (quote.kind === 'visit') return { kind: 'visit', jobTypeKey: key, summary };
  return null;
}

function quoteColumns(quote: GuardedQuote | null): {
  job_summary: string | null;
  job_description: string;
  job_type_key: string | null;
  quote_kind: string | null;
  quote_amount: number | null;
  quote_min: number | null;
  quote_max: number | null;
  quote_given: string;
} {
  if (!quote) {
    return {
      job_summary: null,
      job_description: '',
      job_type_key: null,
      quote_kind: null,
      quote_amount: null,
      quote_min: null,
      quote_max: null,
      quote_given: '',
    };
  }
  const summary = quote.summary.trim().slice(0, 200);
  const given =
    quote.kind === 'firm'
      ? quoteGivenText({ kind: 'firm', amount: quote.amount })
      : quote.kind === 'guide'
        ? quoteGivenText({ kind: 'guide', min: quote.min, max: quote.max })
        : quoteGivenText({ kind: 'visit' });
  return {
    job_summary: summary === '' ? null : summary,
    job_description: summary,
    job_type_key: quote.jobTypeKey,
    quote_kind: quote.kind,
    quote_amount: quote.kind === 'firm' ? quote.amount : null,
    quote_min: quote.kind === 'guide' ? quote.min : null,
    quote_max: quote.kind === 'guide' ? quote.max : null,
    quote_given: given,
  };
}

async function loadLead(admin: SupabaseClient, tenantId: string, leadId: string): Promise<LeadRow | null | 'error'> {
  const { data, error } = await admin.from('leads').select('*').eq('id', leadId).eq('tenant_id', tenantId).maybeSingle();
  if (error) return 'error';
  if (!data) return null;
  return asLead(data) ?? 'error';
}

function moneyAmount(amount: number | undefined): number | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null;
  const rounded = Math.round(amount * 100) / 100;
  if (Math.abs(rounded - amount) > 1e-6) return null;
  if (rounded < 1 || rounded > 50000) return null;
  return rounded;
}

function londonYmd(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function shiftYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

function parseYmd(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  return value;
}

export async function createLeadFromWidget(
  admin: SupabaseClient,
  p: { widget: WidgetRow; conversationId: string; input: WidgetLeadValues },
): Promise<{ ok: true; leadId: string; duplicate: boolean; autoAccepted: boolean } | FieldError> {
  const mobileE164 = normalizeUkPhoneE164(p.input.mobile);
  if (!mobileE164 || !MOBILE_RE.test(mobileE164)) return { ok: false, field: 'mobile', error: 'invalid' };
  const postcode = normalisePostcode(p.input.postcode);
  if (!postcode) return { ok: false, field: 'postcode', error: 'invalid' };
  const preferredDays = cleanDays(p.input.preferredDays);

  const { data: conversation, error: conversationError } = await admin
    .from('widget_conversations')
    .select('id, client_id, visitor_message_count, last_quote')
    .eq('id', p.conversationId)
    .eq('client_id', p.widget.id)
    .maybeSingle();
  if (conversationError) return { ok: false, error: 'save_failed' };
  const chat = conversation as {
    visitor_message_count?: unknown;
    last_quote?: unknown;
  } | null;
  const messages = chat?.visitor_message_count;
  if (!chat || typeof messages !== 'number' || messages < 1) return { ok: false, error: 'no_conversation' };

  const quote = asQuote(chat.last_quote);
  const columns = quoteColumns(quote);
  const now = new Date().toISOString();
  const note = p.input.note?.trim() ?? '';
  const email = p.input.email?.trim() ?? '';
  const row = {
    tenant_id: p.widget.tenant_id,
    client_id: p.widget.id,
    widget_conversation_id: p.conversationId,
    source: 'widget',
    status: 'new',
    name: p.input.name.trim(),
    phone: formatUkPhoneDisplay(mobileE164),
    phone_e164: mobileE164,
    email: email === '' ? null : email,
    postcode,
    preferred_days: preferredDays,
    customer_note: note === '' ? null : note,
    ...columns,
    booking_status: p.input.wantsBooking && quote ? 'requested' : 'none',
    status_changed_at: now,
  };

  const { data: inserted, error: insertError } = await admin.from('leads').insert(row).select('*').maybeSingle();
  if (insertError) {
    const code = (insertError as { code?: string }).code;
    if (code === '23505') {
      const existing = await loadLeadByConversation(admin, p.widget.tenant_id, p.conversationId);
      return { ok: true, leadId: existing?.id ?? '', duplicate: true, autoAccepted: false };
    }
    return { ok: false, error: 'save_failed' };
  }
  let lead = asLead(inserted);
  if (!lead) return { ok: false, error: 'save_failed' };

  let autoAccepted = false;
  if (lead.booking_status === 'requested' && lead.quote_kind === 'firm' && lead.job_type_key) {
    try {
      const profile = await loadWidgetProfile(admin, p.widget.tenant_id);
      const job = profile?.job_types.find((item) => item.key === lead?.job_type_key);
      if (job?.auto_accept === true) {
        const decided = await decideBooking(admin, {
          tenantId: p.widget.tenant_id,
          leadId: lead.id,
          by: 'auto',
          decision: 'accept',
        });
        if (decided.ok) {
          lead = decided.lead;
          autoAccepted = true;
        } else {
          console.error('[lite lead]', lead.id, 'auto-accept failed');
        }
      }
    } catch {
      console.error('[lite lead]', lead.id, 'auto-accept failed');
    }
  }

  try {
    await onLeadCreated(admin, lead);
  } catch {
    console.error('[lite lead]', lead.id, 'onLeadCreated');
  }
  return { ok: true, leadId: lead.id, duplicate: false, autoAccepted };
}

async function loadLeadByConversation(
  admin: SupabaseClient,
  tenantId: string,
  conversationId: string,
): Promise<LeadRow | null> {
  const { data, error } = await admin
    .from('leads')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('widget_conversation_id', conversationId)
    .maybeSingle();
  if (error || !data) return null;
  return asLead(data);
}

export async function decideBooking(
  admin: SupabaseClient,
  p: {
    tenantId: string;
    leadId: string;
    by: 'owner' | 'auto';
    decision: 'accept' | 'decline' | 'change_price';
    newAmount?: number;
    tellCustomer?: boolean;
  },
): Promise<
  | { ok: true; lead: LeadRow }
  | { ok: false; error: 'not_found' | 'not_requested' | 'bad_amount' | 'not_firm' | 'save_failed'; lead?: LeadRow }
> {
  const current = await loadLead(admin, p.tenantId, p.leadId);
  if (current === 'error') return { ok: false, error: 'save_failed' };
  if (!current) return { ok: false, error: 'not_found' };
  if (p.decision === 'change_price' && current.quote_kind !== 'firm') return { ok: false, error: 'not_firm' };

  let agreed: number | null = null;
  if (p.decision === 'change_price') {
    agreed = moneyAmount(p.newAmount);
    if (agreed == null) return { ok: false, error: 'bad_amount' };
  } else if (p.decision === 'accept' && current.quote_kind === 'firm') {
    agreed = current.quote_amount;
    if (agreed == null) return { ok: false, error: 'save_failed' };
  }

  const now = new Date().toISOString();
  const accepted = p.decision !== 'decline';
  const { data, error } = await admin
    .from('leads')
    .update({
      booking_status: accepted ? 'accepted' : 'declined',
      status: accepted ? 'won' : 'lost',
      agreed_amount: agreed,
      decided_at: now,
      decided_by: p.by,
      status_changed_at: now,
    })
    .eq('id', p.leadId)
    .eq('tenant_id', p.tenantId)
    .eq('booking_status', 'requested')
    .select('*');
  if (error) return { ok: false, error: 'save_failed' };
  const saved = Array.isArray(data) ? asLead(data[0]) : null;
  if (!saved) {
    const again = await loadLead(admin, p.tenantId, p.leadId);
    if (again === 'error') return { ok: false, error: 'save_failed' };
    if (!again) return { ok: false, error: 'not_found' };
    return { ok: false, error: 'not_requested', lead: again };
  }

  try {
    await onBookingDecided(admin, saved, {
      decision: accepted ? 'accepted' : 'declined',
      tellCustomer: accepted ? true : (p.tellCustomer ?? true),
      priceChanged: p.decision === 'change_price',
    });
  } catch {
    console.error('[lite lead]', saved.id, 'onBookingDecided');
  }
  return { ok: true, lead: saved };
}

export async function setLeadStatus(
  admin: SupabaseClient,
  p: { tenantId: string; leadId: string; status: LeadStatus },
): Promise<{ ok: true } | { ok: false; error: 'not_found' | 'decide_first' | 'save_failed' }> {
  // Launch: the board is a collector — status moves freely. Booking Accept is hidden for now.
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('leads')
    .update({ status: p.status, status_changed_at: now })
    .eq('id', p.leadId)
    .eq('tenant_id', p.tenantId)
    .select('id');
  if (error) return { ok: false, error: 'save_failed' };
  if (Array.isArray(data) && data.length > 0) return { ok: true };
  const again = await loadLead(admin, p.tenantId, p.leadId);
  if (again === 'error') return { ok: false, error: 'save_failed' };
  if (!again) return { ok: false, error: 'not_found' };
  return { ok: false, error: 'save_failed' };
}

export type LeadPrefill = {
  leadId: string;
  name: string;
  phone: string;
  email: string;
  postcode: string;
  notes: string;
};

/** Notes for the new-customer form. Empty parts are left out. */
export function buildLeadPrefill(lead: {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  postcode?: string | null;
  job_summary?: string | null;
  agreed_amount?: unknown;
}): LeadPrefill {
  const summary = typeof lead.job_summary === 'string' ? lead.job_summary.trim() : '';
  const agreed = asNumber(lead.agreed_amount);
  const parts: string[] = [];
  if (summary) parts.push(`From your website: ${summary}.`);
  if (agreed != null) parts.push(`Agreed ${pounds(agreed)}.`);
  return {
    leadId: lead.id,
    name: lead.name,
    phone: lead.phone ?? '',
    email: lead.email ?? '',
    postcode: lead.postcode ?? '',
    notes: parts.join(' '),
  };
}

/**
 * Conditional link. A matching update is `linked`. Zero rows: the same id
 * already stored is `linked`; a different id is `already_linked`.
 */
export async function linkLeadToCustomer(
  admin: SupabaseClient,
  p: { tenantId: string; leadId: string; customerId: string },
): Promise<'linked' | 'already_linked' | 'error'> {
  const { data, error } = await admin
    .from('leads')
    .update({ converted_customer_id: p.customerId })
    .eq('id', p.leadId)
    .eq('tenant_id', p.tenantId)
    .is('converted_customer_id', null)
    .select('id');
  if (error) return 'error';
  if (Array.isArray(data) && data.length > 0) return 'linked';

  const again = await loadLead(admin, p.tenantId, p.leadId);
  if (again === 'error' || !again) return 'error';
  if (again.converted_customer_id === p.customerId) return 'linked';
  if (again.converted_customer_id) return 'already_linked';
  return 'error';
}

export async function linkLeadToJob(
  admin: SupabaseClient,
  p: { tenantId: string; leadId: string; jobId: string; date: Ymd; time: string | null },
): Promise<'linked' | 'already_linked' | 'error'> {
  const { data, error } = await admin
    .from('leads')
    .update({
      converted_job_id: p.jobId,
      booked_for_date: p.date,
      booked_for_time: p.time,
    })
    .eq('id', p.leadId)
    .eq('tenant_id', p.tenantId)
    .is('converted_job_id', null)
    .select('id');
  if (error) return 'error';
  if (Array.isArray(data) && data.length > 0) return 'linked';

  const again = await loadLead(admin, p.tenantId, p.leadId);
  if (again === 'error' || !again) return 'error';
  if (again.converted_job_id === p.jobId) return 'linked';
  if (again.converted_job_id) return 'already_linked';
  return 'error';
}

export async function setBookedFor(
  admin: SupabaseClient,
  p: { tenantId: string; leadId: string; date: Ymd | null; time: string | null },
): Promise<{ ok: true } | { ok: false; error: 'not_found' | 'not_won' | 'bad_date' | 'save_failed' }> {
  let date: string | null = null;
  let time: string | null = null;
  if (p.date == null && p.time == null) {
    date = null;
    time = null;
  } else {
    if (p.date == null) return { ok: false, error: 'bad_date' };
    const parsed = parseYmd(p.date);
    if (!parsed) return { ok: false, error: 'bad_date' };
    const today = londonYmd();
    if (parsed < shiftYmd(today, -30) || parsed > shiftYmd(today, 365)) return { ok: false, error: 'bad_date' };
    if (p.time != null && !TIME_RE.test(p.time)) return { ok: false, error: 'bad_date' };
    date = parsed;
    time = p.time;
  }

  const { data, error } = await admin
    .from('leads')
    .update({ booked_for_date: date, booked_for_time: time })
    .eq('id', p.leadId)
    .eq('tenant_id', p.tenantId)
    .eq('status', 'won')
    .select('id');
  if (error) return { ok: false, error: 'save_failed' };
  if (Array.isArray(data) && data.length > 0) return { ok: true };
  const again = await loadLead(admin, p.tenantId, p.leadId);
  if (again === 'error') return { ok: false, error: 'save_failed' };
  if (!again) return { ok: false, error: 'not_found' };
  if (again.status !== 'won') return { ok: false, error: 'not_won' };
  return { ok: false, error: 'save_failed' };
}
