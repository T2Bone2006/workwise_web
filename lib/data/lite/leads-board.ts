import 'server-only';

import { addDays, isoWeekday, londonDayBoundsUtc, startOfMonth, todayInLondon } from '@/lib/rounds/dates';
import { getSetupStatus, type SetupStatus } from '@/lib/lite/setup-status';
import { readAllPages } from '@/lib/data/read-all-pages';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export type BoardLead = {
  id: string;
  name: string;
  firstName: string;
  jobSummary: string | null;
  quote: { kind: 'firm' | 'guide' | 'visit'; amount?: number; min?: number; max?: number } | null;
  agreedAmount: number | null;
  status: 'new' | 'contacted' | 'won' | 'lost';
  bookingStatus: 'none' | 'requested' | 'accepted' | 'declined';
  decidedBy: 'owner' | 'auto' | null;
  createdAt: string;
  statusChangedAt: string | null;
  bookedForDate: string | null;
  bookedForTime: string | null;
  postcode: string | null;
  mobileDisplay: string | null;
  preferredDays: string[];
  flags: {
    followUpProblem: 'out_of_texts' | 'opted_out' | 'failed' | 'stuck' | null;
    replied: boolean;
    converted: boolean;
  };
};

export type LeadsBoardData = {
  waiting: BoardLead[];
  columns: Record<'new' | 'contacted' | 'won' | 'lost', BoardLead[]>;
  booked: BoardLead[];
  tiles: {
    waiting: number;
    newThisWeek: number;
    wonThisMonth: { count: number; amount: number };
    chatsThisWeek: { total: number; leftDetails: number };
  };
  setup: SetupStatus;
  websiteSet: boolean;
};

const STATUSES = ['new', 'contacted', 'won', 'lost'] as const;
const BOOKING = ['none', 'requested', 'accepted', 'declined'] as const;
const PROBLEMS = ['out_of_texts', 'opted_out', 'failed', 'stuck'] as const;

type Status = (typeof STATUSES)[number];
type Problem = (typeof PROBLEMS)[number];

export type LeadSource = {
  id: string;
  name: string;
  jobSummary: string | null;
  quote: BoardLead['quote'];
  agreedAmount: number | null;
  status: Status;
  bookingStatus: BoardLead['bookingStatus'];
  decidedBy: BoardLead['decidedBy'];
  createdAt: string;
  statusChangedAt: string | null;
  bookedForDate: string | null;
  bookedForTime: string | null;
  postcode: string | null;
  mobileDisplay: string | null;
  preferredDays: string[];
  followUpProblem: Problem | null;
  converted: boolean;
  conversationId: string | null;
};

const LEAD_COLUMNS =
  'id, name, job_summary, quote_kind, quote_amount, quote_min, quote_max, agreed_amount, status, booking_status, decided_by, created_at, status_changed_at, booked_for_date, booked_for_time, postcode, phone, preferred_days, follow_up_problem, converted_customer_id, converted_job_id, widget_conversation_id';

/** Monday 00:00 Europe/London of the week that contains `now`. */
export function londonWeekStart(now: Date): Date {
  const today = todayInLondon(now);
  const monday = addDays(today, 1 - isoWeekday(today));
  return new Date(londonDayBoundsUtc(monday).startIso);
}

/** The 1st 00:00 Europe/London of the month that contains `now`. */
export function londonMonthStart(now: Date): Date {
  return new Date(londonDayBoundsUtc(startOfMonth(todayInLondon(now))).startIso);
}

function columnCutoff(now: Date): number {
  return new Date(londonDayBoundsUtc(addDays(todayInLondon(now), -60)).startIso).getTime();
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
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function quoteOf(row: Record<string, unknown>): BoardLead['quote'] {
  if (row.quote_kind === 'firm') {
    const amount = asNumber(row.quote_amount);
    return amount == null ? null : { kind: 'firm', amount };
  }
  if (row.quote_kind === 'guide') {
    const min = asNumber(row.quote_min);
    const max = asNumber(row.quote_max);
    return min == null || max == null ? null : { kind: 'guide', min, max };
  }
  if (row.quote_kind === 'visit') return { kind: 'visit' };
  return null;
}

function asTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)/.exec(value);
  return match ? `${match[1]}:${match[2]}` : null;
}

function asDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  return value.slice(0, 10);
}

function asStatus(value: unknown): Status | null {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value) ? (value as Status) : null;
}

function asBooking(value: unknown): BoardLead['bookingStatus'] {
  return typeof value === 'string' && (BOOKING as readonly string[]).includes(value)
    ? (value as BoardLead['bookingStatus'])
    : 'none';
}

function asDecidedBy(value: unknown): BoardLead['decidedBy'] {
  return value === 'owner' || value === 'auto' ? value : null;
}

function asProblem(value: unknown): Problem | null {
  return typeof value === 'string' && (PROBLEMS as readonly string[]).includes(value) ? (value as Problem) : null;
}

function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

export function mapLeadRow(raw: unknown): LeadSource | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.name !== 'string') return null;
  const status = asStatus(row.status);
  if (!status) return null;
  const days = Array.isArray(row.preferred_days)
    ? row.preferred_days.filter((day): day is string => typeof day === 'string' && day !== '')
    : [];
  return {
    id: row.id,
    name: row.name,
    jobSummary: asText(row.job_summary),
    quote: quoteOf(row),
    agreedAmount: asNumber(row.agreed_amount),
    status,
    bookingStatus: asBooking(row.booking_status),
    decidedBy: asDecidedBy(row.decided_by),
    createdAt: typeof row.created_at === 'string' ? row.created_at : new Date(0).toISOString(),
    statusChangedAt: typeof row.status_changed_at === 'string' ? row.status_changed_at : null,
    bookedForDate: asDate(row.booked_for_date),
    bookedForTime: asTime(row.booked_for_time),
    postcode: asText(row.postcode),
    mobileDisplay: asText(row.phone),
    preferredDays: days,
    followUpProblem: asProblem(row.follow_up_problem),
    converted: asText(row.converted_customer_id) != null || asText(row.converted_job_id) != null,
    conversationId: asText(row.widget_conversation_id),
  };
}

export function boardLeadFromSource(source: LeadSource, replied = false): BoardLead {
  return toBoardLead(source, replied);
}

function toBoardLead(source: LeadSource, replied: boolean): BoardLead {
  return {
    id: source.id,
    name: source.name,
    firstName: firstNameOf(source.name),
    jobSummary: source.jobSummary,
    quote: source.quote,
    agreedAmount: source.agreedAmount,
    status: source.status,
    bookingStatus: source.bookingStatus,
    decidedBy: source.decidedBy,
    createdAt: source.createdAt,
    statusChangedAt: source.statusChangedAt,
    bookedForDate: source.bookedForDate,
    bookedForTime: source.bookedForTime,
    postcode: source.postcode,
    mobileDisplay: source.mobileDisplay,
    preferredDays: source.preferredDays,
    flags: {
      followUpProblem: source.followUpProblem,
      replied,
      converted: source.converted,
    },
  };
}

function inRange(iso: string, startMs: number, endMs: number): boolean {
  const time = new Date(iso).getTime();
  return Number.isFinite(time) && time >= startMs && time <= endMs;
}

function byCreatedDesc(a: BoardLead, b: BoardLead): number {
  return b.createdAt.localeCompare(a.createdAt);
}

/**
 * Group a business's leads into the board. Won and Lost columns keep the last
 * 60 London days; Booked keeps every accepted win (dated from today onwards, then undated).
 */
export function groupLeadsBoard(input: {
  leads: LeadSource[];
  repliedIds: ReadonlySet<string>;
  conversationIdsThisWeek: readonly string[];
  setup: SetupStatus;
  now: Date;
}): LeadsBoardData {
  const leads = input.leads.map((source) => toBoardLead(source, input.repliedIds.has(source.id)));
  const byId = new Map(input.leads.map((source) => [source.id, source]));
  const weekStart = londonWeekStart(input.now).getTime();
  const monthStart = londonMonthStart(input.now).getTime();
  const nowMs = input.now.getTime();
  const cutoff = columnCutoff(input.now);
  const today = todayInLondon(input.now);

  const waiting = leads
    .filter((lead) => lead.bookingStatus === 'requested')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const columns: LeadsBoardData['columns'] = { new: [], contacted: [], won: [], lost: [] };
  for (const lead of leads) {
    if (lead.status === 'won' || lead.status === 'lost') {
      const source = byId.get(lead.id);
      const changed = source?.statusChangedAt ?? source?.createdAt ?? lead.createdAt;
      if (new Date(changed).getTime() < cutoff) continue;
    }
    columns[lead.status].push(lead);
  }
  for (const status of STATUSES) columns[status].sort(byCreatedDesc);

  const accepted = leads.filter((lead) => lead.status === 'won' && lead.bookingStatus === 'accepted');
  const dated = accepted
    .filter((lead) => lead.bookedForDate != null && lead.bookedForDate >= today)
    .sort((a, b) => {
      const byDate = (a.bookedForDate ?? '').localeCompare(b.bookedForDate ?? '');
      if (byDate !== 0) return byDate;
      return (a.bookedForTime ?? '99:99').localeCompare(b.bookedForTime ?? '99:99');
    });
  const undated = accepted.filter((lead) => lead.bookedForDate == null).sort(byCreatedDesc);

  const wonThisMonth = leads.filter((lead) => {
    if (lead.status !== 'won') return false;
    const source = byId.get(lead.id);
    return inRange(source?.statusChangedAt ?? source?.createdAt ?? lead.createdAt, monthStart, nowMs);
  });
  const amount = wonThisMonth.reduce((sum, lead) => {
    return typeof lead.agreedAmount === 'number' ? sum + lead.agreedAmount : sum;
  }, 0);

  const conversationIds = new Set(
    input.leads.map((source) => source.conversationId).filter((id): id is string => id != null),
  );

  return {
    waiting,
    columns,
    booked: [...dated, ...undated],
    tiles: {
      waiting: waiting.length,
      newThisWeek: leads.filter((lead) => inRange(lead.createdAt, weekStart, nowMs)).length,
      wonThisMonth: {
        count: wonThisMonth.length,
        amount: Math.round(amount * 100) / 100,
      },
      chatsThisWeek: {
        total: input.conversationIdsThisWeek.length,
        leftDetails: input.conversationIdsThisWeek.filter((id) => conversationIds.has(id)).length,
      },
    },
    setup: input.setup,
    websiteSet: input.setup.state === 'live' && input.setup.website != null,
  };
}

export async function getLeadsBoard(tenantId: string, now: Date = new Date()): Promise<LeadsBoardData> {
  const supabase = await createClient();
  const weekStartIso = londonWeekStart(now).toISOString();
  const [leadRows, replyRows, chatRows, setup] = await Promise.all([
    readAllPages(
      (from, to) =>
        supabase
          .from('leads')
          .select(LEAD_COLUMNS)
          .eq('tenant_id', tenantId)
          .order('id', { ascending: true })
          .range(from, to),
      'Could not load leads',
    ),
    readAllPages(
      (from, to) =>
        supabase
          .from('lite_texts')
          .select('id, lead_id')
          .eq('tenant_id', tenantId)
          .eq('kind', 'reply_in')
          .order('id', { ascending: true })
          .range(from, to),
      'Could not load leads',
    ),
    readAllPages(
      (from, to) =>
        supabase
          .from('widget_conversations')
          .select('id')
          .eq('tenant_id', tenantId)
          .gte('created_at', weekStartIso)
          .order('id', { ascending: true })
          .range(from, to),
      'Could not load leads',
    ),
    getSetupStatus(createAdminClient(), tenantId),
  ]);

  const leads = leadRows.map(mapLeadRow).filter((row): row is LeadSource => row != null);
  const repliedIds = new Set(
    replyRows
      .map((row) => (typeof row.lead_id === 'string' ? row.lead_id : null))
      .filter((id): id is string => id != null),
  );
  const conversationIdsThisWeek = chatRows
    .map((row) => (typeof row.id === 'string' ? row.id : null))
    .filter((id): id is string => id != null);

  return groupLeadsBoard({ leads, repliedIds, conversationIdsThisWeek, setup, now });
}
