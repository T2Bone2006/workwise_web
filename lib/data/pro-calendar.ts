import { createClient } from '@/lib/supabase/server';
import { isValidYmd, type Ymd } from '@/lib/rounds/dates';
import type { ProCalendarJob } from '@/lib/jobs/pro-calendar';

/** Rows per request; the database hands back at most this many at once. */
const PAGE = 1000;
/** Dated jobs loaded in one go (a few weeks of a big team). */
const DATED_CAP = 6000;
/** Jobs with no date, shown in the "No date" column. */
const UNDATED_CAP = 200;

const JOB_COLUMNS = `
  id,
  reference_number,
  address,
  postcode,
  job_description,
  status,
  priority,
  scheduled_date,
  scheduled_time,
  assigned_worker_id,
  job_group_id,
  route_position,
  customer:customers!customer_id(name),
  worker:workers!assigned_worker_id(full_name),
  job_group:job_groups!job_group_id(id, label)
`;

export type ProCalendarLoad = {
  jobs: ProCalendarJob[];
  undated: ProCalendarJob[];
  truncated: boolean;
  error: Error | null;
};

function mapRow(row: Record<string, unknown>): ProCalendarJob {
  const customer = row.customer as { name?: string } | null;
  const worker = row.worker as { full_name?: string } | null;
  const group = row.job_group as { id?: string; label?: string } | null;
  const address = typeof row.address === 'string' ? row.address.trim() : '';
  const reference = typeof row.reference_number === 'string' ? row.reference_number.trim() : '';
  const timeRaw = typeof row.scheduled_time === 'string' ? row.scheduled_time : '';
  const dateRaw = typeof row.scheduled_date === 'string' ? row.scheduled_date.slice(0, 10) : '';
  return {
    id: String(row.id),
    reference: reference || null,
    title: address || reference || 'Job',
    postcode: typeof row.postcode === 'string' && row.postcode.trim() ? row.postcode.trim() : null,
    customer: customer?.name?.trim() || null,
    worker: worker?.full_name?.trim() || null,
    workerId: typeof row.assigned_worker_id === 'string' ? row.assigned_worker_id : null,
    status: typeof row.status === 'string' ? row.status : null,
    priority: typeof row.priority === 'string' ? row.priority : null,
    time: timeRaw.length >= 5 ? timeRaw.slice(0, 5) : null,
    date: isValidYmd(dateRaw) ? dateRaw : null,
    detail: typeof row.job_description === 'string' && row.job_description.trim() ? row.job_description.trim() : null,
    groupId: typeof row.job_group_id === 'string' ? row.job_group_id : null,
    groupLabel: group?.label?.trim() || null,
    position: typeof row.route_position === 'number' && Number.isFinite(row.route_position) ? row.route_position : null,
  };
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Everything scheduled between `from` and `to` (not cancelled), a page at a time up to the cap. */
async function datedJobs(
  supabase: Supabase,
  tenantId: string,
  from: Ymd,
  to: Ymd,
): Promise<{ rows: Record<string, unknown>[]; truncated: boolean; error: Error | null }> {
  const rows: Record<string, unknown>[] = [];
  while (rows.length < DATED_CAP) {
    const { data, error } = await supabase
      .from('jobs')
      .select(JOB_COLUMNS)
      .eq('tenant_id', tenantId)
      .neq('status', 'cancelled')
      .gte('scheduled_date', from)
      .lte('scheduled_date', to)
      .order('scheduled_date', { ascending: true })
      .order('route_position', { ascending: true, nullsFirst: false })
      .order('scheduled_time', { ascending: true })
      .order('id', { ascending: true })
      .range(rows.length, Math.min(rows.length + PAGE, DATED_CAP) - 1);
    if (error) return { rows, truncated: false, error: new Error(error.message) };
    const page = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < PAGE) return { rows, truncated: false, error: null };
  }
  return { rows, truncated: true, error: null };
}

/** Just the dated jobs, for the week board as it scrolls to more weeks. Never throws. */
export async function getProCalendarDated(
  tenantId: string,
  from: Ymd,
  to: Ymd,
): Promise<{ jobs: ProCalendarJob[]; truncated: boolean; error: Error | null }> {
  try {
    const supabase = await createClient();
    const dated = await datedJobs(supabase, tenantId, from, to);
    if (dated.error) console.error('[getProCalendarDated]', dated.error);
    return { jobs: dated.rows.map(mapRow), truncated: dated.truncated, error: dated.error };
  } catch (err) {
    console.error('[getProCalendarDated]', err);
    return { jobs: [], truncated: false, error: err instanceof Error ? err : new Error('Failed to load the calendar') };
  }
}

/**
 * Jobs on the calendar: everything scheduled between `from` and `to`, plus jobs
 * with no date. Never throws.
 */
export async function getProCalendarJobs(tenantId: string, from: Ymd, to: Ymd): Promise<ProCalendarLoad> {
  try {
    const supabase = await createClient();
    const [dated, undated] = await Promise.all([
      datedJobs(supabase, tenantId, from, to),
      supabase
        .from('jobs')
        .select(JOB_COLUMNS)
        .eq('tenant_id', tenantId)
        .not('status', 'in', '(cancelled,completed)')
        .is('scheduled_date', null)
        .order('route_position', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(0, UNDATED_CAP - 1),
    ]);

    if (dated.error || undated.error) {
      const message = dated.error?.message ?? undated.error?.message ?? 'Failed to load the calendar';
      console.error('[getProCalendarJobs]', dated.error ?? undated.error);
      return { jobs: [], undated: [], truncated: false, error: new Error(message) };
    }

    const jobs = dated.rows.map(mapRow);
    const noDate = (Array.isArray(undated.data) ? undated.data : []).map((row) =>
      mapRow(row as Record<string, unknown>),
    );
    return {
      jobs,
      undated: noDate,
      truncated: dated.truncated || noDate.length >= UNDATED_CAP,
      error: null,
    };
  } catch (err) {
    console.error('[getProCalendarJobs]', err);
    return {
      jobs: [],
      undated: [],
      truncated: false,
      error: err instanceof Error ? err : new Error('Failed to load the calendar'),
    };
  }
}
