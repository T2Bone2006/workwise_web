import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { getWorkerLink } from '@/lib/auth/worker-link';
import { resolveJobSheetFields, parseWorkerVisibleFields } from '@/lib/jobs/worker-visible-fields';
import {
  WORKER_JOB_COLUMNS,
  blockedReason,
  historyLines,
  mapJobRow,
  type JobRowForWorker,
} from '@/lib/worker/map-job';
import { UNFINISHED_STATUSES } from '@/lib/worker/status';
import type { JobsTab, WorkerJob, WorkerJobDetail } from '@/lib/worker/types';

/**
 * Everything here reads with the worker's own session, never the admin client: the database's
 * own rules decide what a worker may see, and these queries only ask for their own jobs.
 * A failed read becomes an empty result and a short log line, never a thrown error.
 */

export const JOBS_PAGE_SIZE = 25;

const SELECT_WITH_CUSTOMER = `${WORKER_JOB_COLUMNS}, customers(name)`;
/** Never shown to a worker, or another worker's work. */
const HIDDEN_FROM_WORKER = '(pending,pending_send,cancelled,declined)';

function fail(tag: string, error: { message?: string } | null | undefined): void {
  console.error(`[worker/jobs] ${tag}`, error?.message ? error.message.slice(0, 120) : '');
}

type RangeResult = { jobs: WorkerJob[]; ok: boolean };

/** The worker's dispatched jobs scheduled between two days (inclusive), soonest first. */
export async function getMyJobsInRangeResult(from: string, to: string): Promise<RangeResult> {
  const link = await getWorkerLink();
  if (!link) return { jobs: [], ok: true };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('jobs')
    .select(SELECT_WITH_CUSTOMER)
    .eq('assigned_worker_id', link.workerId)
    .not('status', 'in', HIDDEN_FROM_WORKER)
    .gte('scheduled_date', from)
    .lte('scheduled_date', to)
    .order('scheduled_date', { ascending: true })
    .order('scheduled_time', { ascending: true, nullsFirst: false })
    .returns<JobRowForWorker[]>();

  if (error || !data) {
    fail('range', error);
    return { jobs: [], ok: false };
  }
  return { jobs: data.map((row) => mapJobRow(row)).filter((j): j is WorkerJob => j !== null), ok: true };
}

export async function getMyJobsInRange(from: string, to: string): Promise<WorkerJob[]> {
  return (await getMyJobsInRangeResult(from, to)).jobs;
}

/** Why each not-completed job stopped, from the history row the phone wrote. */
async function notBecauseByJob(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (jobIds.length === 0) return out;
  const { data, error } = await supabase
    .from('job_status_history')
    .select('job_id, metadata, created_at')
    .in('job_id', jobIds)
    .eq('to_status', 'incomplete')
    .order('created_at', { ascending: true });
  if (error || !data) {
    if (error) fail('not-because', error);
    return out;
  }
  for (const row of data as Array<{ job_id: string | null; metadata: unknown }>) {
    const reason = blockedReason(row.metadata);
    if (row.job_id && reason) out.set(row.job_id, reason); // later rows overwrite earlier ones
  }
  return out;
}

/** Jobs this worker declined. They are no longer assigned to them, so the history is the record. */
async function declinedJobIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workerId: string,
): Promise<{ ids: string[]; ok: boolean }> {
  const { data, error } = await supabase
    .from('job_status_history')
    .select('job_id')
    .eq('changed_by_worker_id', workerId)
    .eq('to_status', 'declined');
  if (error || !data) {
    fail('declined-history', error);
    return { ids: [], ok: false };
  }
  const ids = [
    ...new Set((data as Array<{ job_id: string | null }>).map((r) => r.job_id).filter((id): id is string => !!id)),
  ];
  return { ids, ok: true };
}

export type HistoryPage = { jobs: WorkerJob[]; hasMore: boolean; ok: boolean };

export async function getMyJobsHistory(opts: { tab: JobsTab; page: number }): Promise<HistoryPage> {
  const link = await getWorkerLink();
  if (!link) return { jobs: [], hasMore: false, ok: true };

  const page = Number.isFinite(opts.page) && opts.page >= 1 ? Math.floor(opts.page) : 1;
  const from = (page - 1) * JOBS_PAGE_SIZE;
  const to = from + JOBS_PAGE_SIZE; // one extra row tells us there is another page
  const supabase = await createClient();

  let rows: JobRowForWorker[] | null = null;

  if (opts.tab === 'declined') {
    const declined = await declinedJobIds(supabase, link.workerId);
    if (!declined.ok) return { jobs: [], hasMore: false, ok: false };
    if (declined.ids.length === 0) return { jobs: [], hasMore: false, ok: true };
    const { data, error } = await supabase
      .from('jobs')
      .select(SELECT_WITH_CUSTOMER)
      .in('id', declined.ids)
      .order('scheduled_date', { ascending: false, nullsFirst: false })
      .order('id')
      .range(from, to)
      .returns<JobRowForWorker[]>();
    if (error) fail('declined', error);
    rows = error ? null : data;
  } else {
    let query = supabase.from('jobs').select(SELECT_WITH_CUSTOMER).eq('assigned_worker_id', link.workerId);
    if (opts.tab === 'upcoming') {
      query = query
        .in('status', [...UNFINISHED_STATUSES])
        .order('scheduled_date', { ascending: true, nullsFirst: false })
        .order('scheduled_time', { ascending: true, nullsFirst: false });
    } else if (opts.tab === 'done') {
      query = query
        .eq('status', 'completed')
        .order('completed_at', { ascending: false, nullsFirst: false });
    } else {
      query = query
        .eq('status', 'incomplete')
        .order('scheduled_date', { ascending: false, nullsFirst: false });
    }
    const { data, error } = await query.order('id').range(from, to).returns<JobRowForWorker[]>();
    if (error) fail(opts.tab, error);
    rows = error ? null : data;
  }

  if (!rows) return { jobs: [], hasMore: false, ok: false };

  const hasMore = rows.length > JOBS_PAGE_SIZE;
  const pageRows = rows.slice(0, JOBS_PAGE_SIZE);
  const reasons =
    opts.tab === 'not_completed'
      ? await notBecauseByJob(
          supabase,
          pageRows.map((r) => r.id),
        )
      : new Map<string, string>();

  const jobs = pageRows
    .map((row) => mapJobRow(row, reasons.get(row.id) ?? null))
    .filter((j): j is WorkerJob => j !== null);
  return { jobs, hasMore, ok: true };
}

type DetailCustomer = { name?: string | null; phone?: string | null; worker_visible_fields?: unknown };
type DetailRow = Omit<JobRowForWorker, 'customers'> & {
  assigned_worker_id: string | null;
  source_fields: unknown;
  customers?: DetailCustomer | DetailCustomer[] | null;
};

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
  }
  return out;
}

/** One job in full, or null when it is not this worker's (or does not exist, or has not been sent). */
export async function getMyJob(id: string): Promise<WorkerJobDetail | null> {
  const link = await getWorkerLink();
  if (!link) return null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('jobs')
    .select(`${WORKER_JOB_COLUMNS}, assigned_worker_id, source_fields, customers(name, phone, worker_visible_fields)`)
    .eq('id', id)
    .maybeSingle<DetailRow>();
  if (error || !data) {
    if (error) fail('detail', error);
    return null;
  }

  const [historyRes, declinedRes] = await Promise.all([
    supabase
      .from('job_status_history')
      .select('to_status, created_at, metadata, changed_by_worker_id')
      .eq('job_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('job_status_history')
      .select('job_id')
      .eq('job_id', id)
      .eq('changed_by_worker_id', link.workerId)
      .eq('to_status', 'declined')
      .limit(1),
  ]);

  const mine = data.assigned_worker_id === link.workerId;
  const declinedByMe = !mine && !declinedRes.error && (declinedRes.data?.length ?? 0) > 0;
  if (!mine && !declinedByMe) return null;
  if (mine && (data.status === 'pending' || data.status === 'pending_send')) return null;

  const history = historyRes.error || !historyRes.data ? [] : historyLines(historyRes.data);
  const base = mapJobRow(data, blockedReasonFromHistory(historyRes.data));
  if (!base) return null;

  const customer = Array.isArray(data.customers) ? data.customers[0] : data.customers;
  if (declinedByMe) {
    // A job they turned down: the basics, no customer and no sheet.
    return {
      ...base,
      customerName: null,
      description: base.title,
      sheet: [],
      customerPhone: null,
      declinedByMe: true,
      history,
    };
  }

  return {
    ...base,
    description: (data.job_description ?? '').trim() || base.title,
    sheet: resolveJobSheetFields(
      asStringRecord(data.source_fields),
      parseWorkerVisibleFields(customer?.worker_visible_fields ?? null),
    ),
    customerPhone: customer?.phone?.trim() || null,
    declinedByMe: false,
    history,
  };
}

function blockedReasonFromHistory(rows: unknown): string | null {
  if (!Array.isArray(rows)) return null;
  let reason: string | null = null;
  for (const row of rows as Array<{ to_status?: string | null; metadata?: unknown }>) {
    if (row.to_status === 'incomplete') reason = blockedReason(row.metadata) ?? reason;
  }
  return reason;
}

/** Jobs sent to the worker that they have not accepted yet, soonest first (undated last). */
export async function getMyWaitingJobs(): Promise<WorkerJob[]> {
  const link = await getWorkerLink();
  if (!link) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('jobs')
    .select(SELECT_WITH_CUSTOMER)
    .eq('assigned_worker_id', link.workerId)
    .eq('status', 'assigned')
    .order('scheduled_date', { ascending: true, nullsFirst: false })
    .order('scheduled_time', { ascending: true, nullsFirst: false })
    .returns<JobRowForWorker[]>();
  if (error || !data) {
    fail('waiting', error);
    return [];
  }
  return data.map((row) => mapJobRow(row)).filter((j): j is WorkerJob => j !== null);
}
