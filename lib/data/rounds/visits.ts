import { createClient } from '@/lib/supabase/server';
import { diffDays, endOfMonth, isValidYmd, startOfMonth, type Ymd } from '@/lib/rounds/dates';
import { sendsInvoice } from '@/lib/payments/terms';
import { filterByPerson, type LanePerson } from '@/lib/rounds/lanes';
import { RESCHEDULE_STATUSES } from '@/lib/rounds/visit-transitions';

export type VisitRow = {
  id: string;
  reference_number: string;
  customer_id: string | null;
  customer_name: string | null;
  service_agreement_id: string | null;
  agreement_occurrence_date: Ymd | null;
  address: string;
  postcode: string;
  lat: number | null;
  lng: number | null;
  job_description: string;
  status: string;
  scheduled_date: Ymd | null;
  scheduled_time: string | null;
  estimated_duration_minutes: number | null;
  quoted_amount: number | null;
  final_amount: number | null;
  payment_status: string | null;
  skip_reason: string | null;
  route_position: number | null;
  completed_at: string | null;
  customer_confirmation_status: string | null;
  customer_requested_date: string | null;
  customer_reply_at: string | null;
  customer_sends_invoice: boolean;
  customer_has_email: boolean;
  /** Who does this visit (workers.id). Null on old rows: the lanes treat that as the owner's. */
  assigned_worker_id: string | null;
  /** The round this visit's agreement is in, if any (the calendar groups houses of a round). */
  round_id: string | null;
  round_name: string | null;
  round_colour: string | null;
  /** Who usually does that round (workers.id); null when it has no usual person, so it is the owner's. */
  round_lead_worker_id?: string | null;
};

/** One round on one day of the month, for the month grid's round chips. */
export type MonthRoundCount = { id: string; name: string; colour: string; count: number };

export type VisitDayCounts = {
  total: number;
  done: number;
  skipped: number;
  /** Sum of quoted_amount for non-cancelled visits (matches home “planned £”). */
  plannedAmount: number;
  /** Rounds with visits that day, biggest first. Absent when nothing is in a round. */
  rounds?: MonthRoundCount[];
};

const ROUND_EMBED = 'service_agreements ( round_id, rounds ( name, colour, usual_lead_worker_id ) )';

const VISIT_SELECT = [
  'id',
  'reference_number',
  'customer_id',
  'service_agreement_id',
  'agreement_occurrence_date',
  'address',
  'postcode',
  'lat',
  'lng',
  'job_description',
  'status',
  'scheduled_date',
  'scheduled_time',
  'estimated_duration_minutes',
  'quoted_amount',
  'final_amount',
  'payment_status',
  'skip_reason',
  'route_position',
  'completed_at',
  'customer_confirmation_status',
  'customer_requested_date',
  'customer_reply_at',
  'assigned_worker_id',
  'created_at',
  'customers ( name, email, payment_terms )',
  ROUND_EMBED,
].join(', ');

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function asYmd(value: unknown): Ymd | null {
  if (typeof value !== 'string' || value.length < 10) return null;
  const sliced = value.slice(0, 10);
  return isValidYmd(sliced) ? sliced : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function embedCustomer(value: unknown): {
  name: string | null;
  email: string | null;
  paymentTerms: string | null;
} {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== 'object') {
    return { name: null, email: null, paymentTerms: null };
  }
  const record = row as { name?: unknown; email?: unknown; payment_terms?: unknown };
  const name = typeof record.name === 'string' && record.name.trim() !== '' ? record.name : null;
  const email = typeof record.email === 'string' && record.email.trim() !== '' ? record.email : null;
  const paymentTerms = typeof record.payment_terms === 'string' ? record.payment_terms : null;
  return { name, email, paymentTerms };
}

function embedRound(value: unknown): { id: string | null; name: string | null; colour: string | null; lead: string | null } {
  const agreement = (Array.isArray(value) ? value[0] : value) as Record<string, unknown> | null | undefined;
  if (!agreement || typeof agreement !== 'object') return { id: null, name: null, colour: null, lead: null };
  const round = (Array.isArray(agreement.rounds) ? agreement.rounds[0] : agreement.rounds) as
    | Record<string, unknown>
    | null
    | undefined;
  const id = asString(agreement.round_id);
  const name = round && typeof round === 'object' ? asString(round.name) : null;
  if (!id || !name) return { id: null, name: null, colour: null, lead: null };
  return {
    id,
    name,
    colour: round && typeof round === 'object' ? asString(round.colour) : null,
    lead: round && typeof round === 'object' ? asString(round.usual_lead_worker_id) : null,
  };
}

export function mapVisitRow(raw: Record<string, unknown>): VisitRow | null {
  const id = asString(raw.id);
  const referenceNumber = asString(raw.reference_number);
  const address = asString(raw.address);
  const postcode = asString(raw.postcode);
  const jobDescription = asString(raw.job_description);
  const status = asString(raw.status);
  if (!id || !referenceNumber || !address || !postcode || !jobDescription || !status) {
    return null;
  }

  const customer = embedCustomer(raw.customers);
  const round = embedRound(raw.service_agreements);

  return {
    id,
    reference_number: referenceNumber,
    customer_id: asString(raw.customer_id),
    customer_name: customer.name,
    customer_sends_invoice: sendsInvoice(customer.paymentTerms),
    customer_has_email: customer.email != null,
    assigned_worker_id: asString(raw.assigned_worker_id),
    round_id: round.id,
    round_name: round.name,
    round_colour: round.colour,
    round_lead_worker_id: round.lead,
    service_agreement_id: asString(raw.service_agreement_id),
    agreement_occurrence_date: asYmd(raw.agreement_occurrence_date),
    address,
    postcode,
    lat: asFiniteNumber(raw.lat),
    lng: asFiniteNumber(raw.lng),
    job_description: jobDescription,
    status,
    scheduled_date: asYmd(raw.scheduled_date),
    scheduled_time: asString(raw.scheduled_time),
    estimated_duration_minutes: asFiniteNumber(raw.estimated_duration_minutes),
    quoted_amount: asFiniteNumber(raw.quoted_amount),
    final_amount: asFiniteNumber(raw.final_amount),
    payment_status: asString(raw.payment_status),
    skip_reason: asString(raw.skip_reason),
    route_position: asFiniteNumber(raw.route_position),
    completed_at: asString(raw.completed_at),
    customer_confirmation_status: asString(raw.customer_confirmation_status),
    customer_requested_date: asString(raw.customer_requested_date),
    customer_reply_at: asString(raw.customer_reply_at),
  };
}

export function foldVisitCounts(
  rows: Array<{
    scheduled_date: unknown;
    status: unknown;
    quoted_amount?: unknown;
    service_agreements?: unknown;
  }>,
): Record<Ymd, VisitDayCounts> {
  const counts: Record<Ymd, VisitDayCounts> = {};
  for (const row of rows) {
    const date = asYmd(row.scheduled_date);
    if (!date) continue;
    const bucket = counts[date] ?? {
      total: 0,
      done: 0,
      skipped: 0,
      plannedAmount: 0,
    };
    bucket.total += 1;
    if (row.status === 'completed') bucket.done += 1;
    if (row.status === 'cancelled') {
      bucket.skipped += 1;
    } else {
      bucket.plannedAmount += asFiniteNumber(row.quoted_amount) ?? 0;
    }
    const round = row.service_agreements === undefined ? null : embedRound(row.service_agreements);
    if (round?.id && round.name && row.status !== 'cancelled') {
      const list = (bucket.rounds ??= []);
      const found = list.find((r) => r.id === round.id);
      if (found) found.count += 1;
      else list.push({ id: round.id, name: round.name, colour: round.colour ?? '#475569', count: 1 });
    }
    counts[date] = bucket;
  }
  for (const bucket of Object.values(counts)) bucket.rounds?.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return counts;
}

function mapRows(data: unknown[] | null): VisitRow[] {
  const visits: VisitRow[] = [];
  for (const row of data ?? []) {
    const mapped = mapVisitRow(row as Record<string, unknown>);
    if (mapped) visits.push(mapped);
  }
  return visits;
}

export async function getVisitsForDay(
  tenantId: string,
  date: Ymd,
): Promise<{ visits: VisitRow[]; error: Error | null }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('jobs')
      .select(VISIT_SELECT)
      .eq('tenant_id', tenantId)
      .eq('scheduled_date', date)
      .order('route_position', { ascending: true, nullsFirst: false })
      .order('scheduled_time', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[getVisitsForDay]', error);
      return { visits: [], error: new Error(error.message) };
    }
    return { visits: mapRows(data), error: null };
  } catch (err) {
    console.error('[getVisitsForDay]', err);
    return {
      visits: [],
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/** The longest run of days `getVisitsForRange` will read in one go. */
export const MAX_RANGE_DAYS = 120;

/** Every visit from `from` to `to` (inclusive), for the Week board. Same columns as the day plan, date first. */
export async function getVisitsForRange(
  tenantId: string,
  from: Ymd,
  to: Ymd,
): Promise<{ visits: VisitRow[]; error: Error | null }> {
  if (!isValidYmd(from) || !isValidYmd(to) || to < from || diffDays(from, to) > MAX_RANGE_DAYS) {
    return { visits: [], error: new Error('Pick a shorter run of days.') };
  }
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('jobs')
      .select(VISIT_SELECT)
      .eq('tenant_id', tenantId)
      .gte('scheduled_date', from)
      .lte('scheduled_date', to)
      .order('scheduled_date', { ascending: true })
      .order('route_position', { ascending: true, nullsFirst: false })
      .order('scheduled_time', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[getVisitsForRange]', error);
      return { visits: [], error: new Error(error.message) };
    }
    return { visits: mapRows(data), error: null };
  } catch (err) {
    console.error('[getVisitsForRange]', err);
    return {
      visits: [],
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

export async function getVisitCountsForMonth(
  tenantId: string,
  monthYmd: Ymd,
  /** Count only one person's visits (the calendar's Person filter). Everyone when left out. */
  person?: { personId: string | 'all' | 'mine'; people: ReadonlyArray<LanePerson> },
): Promise<{ counts: Record<Ymd, VisitDayCounts>; error: Error | null }> {
  try {
    const supabase = await createClient();
    const from = startOfMonth(monthYmd);
    const to = endOfMonth(monthYmd);
    const { data, error } = await supabase
      .from('jobs')
      .select(`scheduled_date, status, quoted_amount, assigned_worker_id, ${ROUND_EMBED}`)
      .eq('tenant_id', tenantId)
      .gte('scheduled_date', from)
      .lte('scheduled_date', to);

    if (error) {
      console.error('[getVisitCountsForMonth]', error);
      return { counts: {}, error: new Error(error.message) };
    }

    const rows = ((data ?? []) as unknown as Array<{ assigned_worker_id: string | null }>);
    const kept = person ? filterByPerson(rows, person.personId, person.people) : rows;
    return { counts: foldVisitCounts(kept as unknown as Parameters<typeof foldVisitCounts>[0]), error: null };
  } catch (err) {
    console.error('[getVisitCountsForMonth]', err);
    return {
      counts: {},
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

export async function getUpcomingVisitsForCustomer(
  tenantId: string,
  customerId: string,
  limit = 10,
): Promise<{ visits: VisitRow[]; error: Error | null }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('jobs')
      .select(VISIT_SELECT)
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .in('status', [...RESCHEDULE_STATUSES])
      .order('scheduled_date', { ascending: true, nullsFirst: false })
      .order('scheduled_time', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) {
      console.error('[getUpcomingVisitsForCustomer]', error);
      return { visits: [], error: new Error(error.message) };
    }
    return { visits: mapRows(data), error: null };
  } catch (err) {
    console.error('[getUpcomingVisitsForCustomer]', err);
    return {
      visits: [],
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

export async function getRecentVisitsForCustomer(
  tenantId: string,
  customerId: string,
  limit = 10,
): Promise<{ visits: VisitRow[]; error: Error | null }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('jobs')
      .select(VISIT_SELECT)
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .in('status', ['completed', 'cancelled'])
      .order('completed_at', { ascending: false, nullsFirst: false })
      .order('scheduled_date', { ascending: false, nullsFirst: false })
      .limit(limit);

    if (error) {
      console.error('[getRecentVisitsForCustomer]', error);
      return { visits: [], error: new Error(error.message) };
    }
    return { visits: mapRows(data), error: null };
  } catch (err) {
    console.error('[getRecentVisitsForCustomer]', err);
    return {
      visits: [],
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}
