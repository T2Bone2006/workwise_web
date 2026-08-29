import { createClient } from '@/lib/supabase/server';
import { startOfMonth, startOfDay, endOfDay } from 'date-fns';

/** Main dashboard stat cards — all sourced from `jobs`. */
export interface DashboardJobStatCards {
  /** Jobs currently in progress (`in_progress`). */
  activeJobs: number;
  /** Jobs marked completed today (`completed`, `completed_at` in local calendar day). */
  completedToday: number;
  /** Jobs not yet assigned (`pending`). */
  notStarted: number;
  /** Worker chosen — waiting to send to app (`pending_send`). */
  readyToSend: number;
  /** Assigned to a worker, not yet started (`assigned`). */
  assigned: number;
  /** Worker paused an in-progress job (`paused`). */
  paused: number;
}

export async function getDashboardJobStatCards(tenantId: string): Promise<DashboardJobStatCards> {
  const supabase = await createClient();
  const now = new Date();
  const dayStart = startOfDay(now).toISOString();
  const dayEnd = endOfDay(now).toISOString();

  const [activeRes, completedTodayRes, notStartedRes, readyToSendRes, assignedRes, pausedRes] =
    await Promise.all([
      supabase
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'in_progress'),
      supabase
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'completed')
        .gte('completed_at', dayStart)
        .lte('completed_at', dayEnd),
      supabase
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'pending'),
      supabase
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'pending_send'),
      supabase
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'assigned'),
      supabase
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'paused'),
    ]);

  return {
    activeJobs: activeRes.count ?? 0,
    completedToday: completedTodayRes.count ?? 0,
    notStarted: notStartedRes.count ?? 0,
    readyToSend: readyToSendRes.count ?? 0,
    assigned: assignedRes.count ?? 0,
    paused: pausedRes.count ?? 0,
  };
}

export interface ActivityFeedItem {
  id: string;
  created_at: string;
  from_status: string | null;
  to_status: string;
  job_id: string | null;
  reference_number: string | null;
  user_name: string | null;
  worker_name: string | null;
}

/**
 * Recent job status history for the tenant (last 10 events).
 */
export async function getRecentActivity(tenantId: string, limit = 10): Promise<ActivityFeedItem[]> {
  const supabase = await createClient();

  // Scope by tenant through the embedded join (jobs!inner + a filter on the
  // embedded column), not by fetching every job id and sending .in(job_id,
  // [...]) — that puts the whole id list in the URL, and a tenant with a few
  // hundred jobs blows past the 16KB header limit outright.
  const { data: rows, error } = await supabase
    .from('job_status_history')
    .select(`
      id,
      created_at,
      from_status,
      to_status,
      job_id,
      job:jobs!inner(reference_number, tenant_id),
      user:users!changed_by_user_id(full_name, email),
      worker:workers!changed_by_worker_id(full_name)
    `)
    .eq('job.tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limit * 2);

  if (error) {
    console.error('[getRecentActivity]', error);
    return [];
  }

  const list: ActivityFeedItem[] = [];
  for (const row of rows ?? []) {
    const r = row as {
      id: string;
      created_at: string;
      from_status: string | null;
      to_status: string;
      job_id: string | null;
      job?: { reference_number?: string } | { reference_number?: string }[] | null;
      user?: { full_name?: string; email?: string } | { full_name?: string; email?: string }[] | null;
      worker?: { full_name?: string } | { full_name?: string }[] | null;
    };
    const job = Array.isArray(r.job) ? r.job[0] : r.job;
    const user = Array.isArray(r.user) ? r.user[0] : r.user;
    const worker = Array.isArray(r.worker) ? r.worker[0] : r.worker;
    list.push({
      id: r.id,
      created_at: r.created_at,
      from_status: r.from_status,
      to_status: r.to_status,
      job_id: r.job_id,
      reference_number: job?.reference_number ?? null,
      user_name: user?.full_name?.trim() ? user.full_name : user?.email ?? null,
      worker_name: worker?.full_name ?? null,
    });
    if (list.length >= limit) break;
  }
  return list;
}

export interface DeclinedJobItem {
  id: string;
  created_at: string;
  job_id: string | null;
  reference_number: string | null;
  address: string | null;
  postcode: string | null;
  worker_name: string | null;
  reason: string | null;
}

/**
 * Jobs declined by a worker in the last `sinceDays` (default 7).
 *
 * The job's own `status` bounces straight back to `pending` (see
 * handle_job_declined()), so this reads the audit trail instead — every
 * decline leaves a `from_status = 'declined'` row in job_status_history,
 * whether or not the job later got reassigned. This is a feed of what
 * happened, not a queue of stuck jobs; nothing here needs manual action.
 */
export async function getRecentlyDeclinedJobs(
  tenantId: string,
  sinceDays = 7,
  limit = 20
): Promise<DeclinedJobItem[]> {
  const supabase = await createClient();
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();

  // Scope by tenant through the embedded join, not an .in(job_id, [...id list])
  // built from every job id — see getRecentActivity above for why.
  const { data: rows, error } = await supabase
    .from('job_status_history')
    .select(`
      id,
      created_at,
      job_id,
      metadata,
      job:jobs!inner(reference_number, address, postcode, tenant_id),
      worker:workers!changed_by_worker_id(full_name)
    `)
    .eq('job.tenant_id', tenantId)
    .eq('from_status', 'declined')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[getRecentlyDeclinedJobs]', error);
    return [];
  }

  return (rows ?? []).map((row) => {
    const r = row as {
      id: string;
      created_at: string;
      job_id: string | null;
      metadata: Record<string, unknown> | null;
      job?:
        | { reference_number?: string; address?: string; postcode?: string }
        | { reference_number?: string; address?: string; postcode?: string }[]
        | null;
      worker?: { full_name?: string } | { full_name?: string }[] | null;
    };
    const job = Array.isArray(r.job) ? r.job[0] : r.job;
    const worker = Array.isArray(r.worker) ? r.worker[0] : r.worker;
    const reason = typeof r.metadata?.reason === 'string' ? r.metadata.reason.trim() : '';
    return {
      id: r.id,
      created_at: r.created_at,
      job_id: r.job_id,
      reference_number: job?.reference_number ?? null,
      address: job?.address ?? null,
      postcode: job?.postcode ?? null,
      worker_name: worker?.full_name ?? null,
      reason: reason || null,
    };
  });
}

export interface TopWorkerItem {
  id: string;
  full_name: string;
  jobs_completed: number;
  completion_rate?: number;
  progress: number;
}

/**
 * Top workers by jobs completed this month.
 */
export async function getTopWorkers(tenantId: string, limit = 5): Promise<TopWorkerItem[]> {
  const supabase = await createClient();
  const startOfThisMonth = startOfMonth(new Date()).toISOString();

  const { data: completedJobs, error: jobsError } = await supabase
    .from('jobs')
    .select('assigned_worker_id')
    .eq('tenant_id', tenantId)
    .eq('status', 'completed')
    .gte('completed_at', startOfThisMonth)
    .not('assigned_worker_id', 'is', null);

  if (jobsError || !completedJobs?.length) {
    return [];
  }

  const countByWorker: Record<string, number> = {};
  for (const row of completedJobs) {
    const wid = (row as { assigned_worker_id: string }).assigned_worker_id;
    if (wid) countByWorker[wid] = (countByWorker[wid] ?? 0) + 1;
  }

  const sorted = Object.entries(countByWorker)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([id]) => id);

  if (sorted.length === 0) return [];

  const { data: workers } = await supabase
    .from('workers')
    .select('id, full_name, total_jobs_completed')
    .in('id', sorted)
    .eq('primary_tenant_id', tenantId);

  const byId = new Map((workers ?? []).map((w: { id: string; full_name: string; total_jobs_completed?: number }) => [w.id, w]));
  const maxJobs = Math.max(...Object.values(countByWorker), 1);

  return sorted.map((id) => {
    const w = byId.get(id);
    const jobs = countByWorker[id] ?? 0;
    const total = (w as { total_jobs_completed?: number })?.total_jobs_completed;
    return {
      id,
      full_name: w?.full_name ?? 'Unknown',
      jobs_completed: jobs,
      completion_rate: total != null && total > 0 ? Math.round((jobs / total) * 100) : undefined,
      progress: maxJobs > 0 ? (jobs / maxJobs) * 100 : 0,
    };
  });
}

export interface RecentJobItem {
  id: string;
  reference_number: string | null;
  address: string | null;
  worker_name: string | null;
  status: string | null;
  scheduled_date: string | null;
}

/**
 * Last N jobs for dashboard recent list.
 */
export async function getRecentJobs(tenantId: string, limit = 10): Promise<RecentJobItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('jobs')
    .select(`
      id,
      reference_number,
      address,
      status,
      scheduled_date,
      worker:workers!assigned_worker_id(full_name)
    `)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[getRecentJobs]', error);
    return [];
  }

  return (data ?? []).map((row: Record<string, unknown>) => {
    const worker = row.worker as { full_name?: string } | { full_name?: string }[] | null;
    const w = Array.isArray(worker) ? worker[0] : worker;
    return {
      id: row.id as string,
      reference_number: row.reference_number as string | null,
      address: row.address as string | null,
      worker_name: w?.full_name ?? null,
      status: row.status as string | null,
      scheduled_date: (row.scheduled_date as string | null) ?? null,
    };
  });
}
