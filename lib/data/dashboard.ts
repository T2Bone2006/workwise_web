import { createClient } from '@/lib/supabase/server';
import { startOfMonth, startOfDay, endOfDay } from 'date-fns';

/** Main dashboard stat cards — all sourced from `jobs`. */
export interface DashboardJobStatCards {
  /** Jobs currently in progress (`in_progress`). */
  activeJobs: number;
  /** Jobs marked completed today (`completed`, `completed_at` in local calendar day). */
  completedToday: number;
  /** Jobs not yet assigned / started (`pending`). */
  notStarted: number;
  /** Assigned but not yet in progress (`assigned`). */
  paused: number;
}

export async function getDashboardJobStatCards(tenantId: string): Promise<DashboardJobStatCards> {
  const supabase = await createClient();
  const now = new Date();
  const dayStart = startOfDay(now).toISOString();
  const dayEnd = endOfDay(now).toISOString();

  const [activeRes, completedTodayRes, notStartedRes, pausedRes] = await Promise.all([
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
      .eq('status', 'assigned'),
  ]);

  return {
    activeJobs: activeRes.count ?? 0,
    completedToday: completedTodayRes.count ?? 0,
    notStarted: notStartedRes.count ?? 0,
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
  const { data: jobIds } = await supabase
    .from('jobs')
    .select('id')
    .eq('tenant_id', tenantId);

  const ids = (jobIds ?? []).map((r: { id: string }) => r.id);
  if (ids.length === 0) return [];

  const { data: rows, error } = await supabase
    .from('job_status_history')
    .select(`
      id,
      created_at,
      from_status,
      to_status,
      job_id,
      job:jobs!job_id(reference_number),
      user:users!changed_by_user_id(full_name, email),
      worker:workers!changed_by_worker_id(full_name)
    `)
    .in('job_id', ids)
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
