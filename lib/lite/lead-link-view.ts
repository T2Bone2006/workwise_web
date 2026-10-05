import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveLeadToken } from '@/lib/lite/action-tokens';
import { firstName } from '@/lib/lite/text-templates';
import { formatUkPhoneDisplay } from '@/lib/utils/phone';

export type LeadLinkView =
  | { state: 'invalid' }
  | { state: 'expired' }
  | { state: 'open'; lead: LeadLinkLead; business: { name: string } }
  | { state: 'decided'; lead: LeadLinkLead; business: { name: string } };

export type LeadLinkLead = {
  fullName: string;
  firstName: string;
  mobileDisplay: string | null;
  postcode: string | null;
  jobSummary: string | null;
  quoteKind: 'firm' | 'guide' | 'visit' | null;
  quoteAmount: number | null;
  quoteMin: number | null;
  quoteMax: number | null;
  preferredDays: string[];
  note: string | null;
  bookingStatus: 'none' | 'requested' | 'accepted' | 'declined';
  agreedAmount: number | null;
  decidedAt: string | null;
  decidedBy: 'owner' | 'auto' | null;
};

const LEAD_COLUMNS =
  'name, phone, phone_e164, postcode, job_summary, quote_kind, quote_amount, quote_min, quote_max, preferred_days, customer_note, booking_status, agreed_amount, decided_at, decided_by';

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function money(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function quoteKind(value: unknown): LeadLinkLead['quoteKind'] {
  if (value === 'firm' || value === 'guide' || value === 'visit') return value;
  return null;
}

function mobileDisplay(phone: unknown, phoneE164: unknown): string | null {
  const stored = text(phone);
  if (stored) return stored;
  const formatted = formatUkPhoneDisplay(typeof phoneE164 === 'string' ? phoneE164 : null);
  return formatted === '' ? null : formatted;
}

function asLinkLead(raw: unknown): LeadLinkLead | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.name !== 'string') return null;
  const bookingStatus = row.booking_status;
  if (
    bookingStatus !== 'none' &&
    bookingStatus !== 'requested' &&
    bookingStatus !== 'accepted' &&
    bookingStatus !== 'declined'
  ) {
    return null;
  }
  const days = Array.isArray(row.preferred_days)
    ? row.preferred_days.filter((day): day is string => typeof day === 'string')
    : [];
  const decidedBy = row.decided_by === 'owner' || row.decided_by === 'auto' ? row.decided_by : null;
  return {
    fullName: row.name.trim(),
    firstName: firstName(row.name),
    mobileDisplay: mobileDisplay(row.phone, row.phone_e164),
    postcode: text(row.postcode),
    jobSummary: text(row.job_summary),
    quoteKind: quoteKind(row.quote_kind),
    quoteAmount: money(row.quote_amount),
    quoteMin: money(row.quote_min),
    quoteMax: money(row.quote_max),
    preferredDays: days,
    note: text(row.customer_note),
    bookingStatus,
    agreedAmount: money(row.agreed_amount),
    decidedAt: text(row.decided_at),
    decidedBy,
  };
}

/**
 * Read-only. Opening the link (a person or an email scanner) must not decide the lead.
 * The tenant comes from the token row, never from the URL.
 */
export async function loadLeadLinkView(admin: SupabaseClient, rawToken: string): Promise<LeadLinkView> {
  const token = await resolveLeadToken(admin, rawToken);
  if (token === 'invalid') return { state: 'invalid' };
  if (token === 'expired') return { state: 'expired' };
  if (token === 'error') throw new Error('Could not load this link.');

  const { data, error } = await admin
    .from('leads')
    .select(LEAD_COLUMNS)
    .eq('id', token.leadId)
    .eq('tenant_id', token.tenantId)
    .maybeSingle();
  if (error) throw new Error('Could not load this link.');
  const lead = asLinkLead(data);
  if (!data) return { state: 'invalid' };
  if (!lead) throw new Error('Could not load this link.');

  const widget = await admin
    .from('widget_clients')
    .select('business_name')
    .eq('tenant_id', token.tenantId)
    .maybeSingle();
  if (widget.error) throw new Error('Could not load this link.');
  const name =
    widget.data && typeof widget.data === 'object'
      ? text((widget.data as { business_name?: unknown }).business_name)
      : null;
  if (!name) throw new Error('Could not load this link.');

  const business = { name };
  if (lead.bookingStatus === 'requested') return { state: 'open', lead, business };
  return { state: 'decided', lead, business };
}
