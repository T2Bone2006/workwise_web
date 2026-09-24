import { createClient } from '@/lib/supabase/server';
import { endOfMonth, isValidYmd, startOfMonth, type Ymd } from '@/lib/rounds/dates';
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
};

export type VisitDayCounts = {
  total: number;
  done: number;
  skipped: number;
  /** Sum of quoted_amount for non-cancelled visits (matches home “planned £”). */
  plannedAmount: number;
};

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
  'created_at',
  'customers ( name )',
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

function embedName(value: unknown): string | null {
  if (Array.isArray(value)) return embedName(value[0]);
  if (value && typeof value === 'object' && 'name' in value) {
    const name = (value as { name?: unknown }).name;
    return typeof name === 'string' && name.trim() !== '' ? name : null;
  }
  return null;
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

  return {
    id,
    reference_number: referenceNumber,
    customer_id: asString(raw.customer_id),
    customer_name: embedName(raw.customers),
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
  };
}

export function foldVisitCounts(
  rows: Array<{
    scheduled_date: unknown;
    status: unknown;
    quoted_amount?: unknown;
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
    counts[date] = bucket;
  }
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

export async function getVisitCountsForMonth(
  tenantId: string,
  monthYmd: Ymd,
): Promise<{ counts: Record<Ymd, VisitDayCounts>; error: Error | null }> {
  try {
    const supabase = await createClient();
    const from = startOfMonth(monthYmd);
    const to = endOfMonth(monthYmd);
    const { data, error } = await supabase
      .from('jobs')
      .select('scheduled_date, status, quoted_amount')
      .eq('tenant_id', tenantId)
      .gte('scheduled_date', from)
      .lte('scheduled_date', to);

    if (error) {
      console.error('[getVisitCountsForMonth]', error);
      return { counts: {}, error: new Error(error.message) };
    }

    return { counts: foldVisitCounts(data ?? []), error: null };
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
