import { subDays, format } from 'date-fns';
import { createClient } from '@/lib/supabase/server';
import type { DayJob } from '@/lib/jobs/pro-day';

export type ProNeedsData = {
  /** Pending jobs nobody has been picked for (not sent to the network). */
  unassigned: {
    count: number;
    oldestDate: string | null;
    topReference: string | null;
  };
  /** Jobs whose report said the work didn't get done, in the last 14 days. */
  notCompleted: {
    count: number;
    recent: Array<{
      id: string;
      reference: string | null;
      address: string | null;
    }>;
  };
};

export type ProHomeData = {
  dayJobs: DayJob[];
  needs: ProNeedsData;
};

const EMPTY_NEEDS: ProNeedsData = {
  unassigned: { count: 0, oldestDate: null, topReference: null },
  notCompleted: { count: 0, recent: [] },
};

/** One day's jobs, just enough to count them and see who is on what. */
export async function getProDayJobs(tenantId: string, day: string): Promise<DayJob[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('jobs')
    .select('id, status, assigned_worker_id, reference_number')
    .eq('tenant_id', tenantId)
    .eq('scheduled_date', day)
    .limit(1000);
  if (error) {
    console.error('[getProDayJobs]', error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    id: r.id as string,
    status: r.status as string,
    workerId: (r.assigned_worker_id as string | null) ?? null,
    reference: (r.reference_number as string | null) ?? null,
  }));
}

/** The two backlogs that need a dispatcher: jobs with no worker, and jobs that didn't get done (last 14 days before `day`). */
export async function getProNeeds(tenantId: string, day: string): Promise<ProNeedsData> {
  const supabase = await createClient();
  const since = format(subDays(new Date(`${day}T12:00:00`), 14), 'yyyy-MM-dd');

  const [unassignedRes, incompleteRes] = await Promise.all([
    supabase
      .from('jobs')
      .select('reference_number, scheduled_date', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .is('assigned_worker_id', null)
      .is('network_dispatch_id', null)
      .order('scheduled_date', { ascending: true, nullsFirst: false })
      .limit(1),
    supabase
      .from('jobs')
      .select('id, reference_number, address', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .eq('status', 'incomplete')
      .gte('scheduled_date', since)
      .order('scheduled_date', { ascending: false })
      .limit(3),
  ]);

  if (unassignedRes.error) console.error('[getProNeeds] unassigned', unassignedRes.error.message);
  if (incompleteRes.error) console.error('[getProNeeds] incomplete', incompleteRes.error.message);

  const top = (unassignedRes.data ?? [])[0] as
    { reference_number?: string | null; scheduled_date?: string | null } | undefined;
  if (unassignedRes.error || incompleteRes.error) return EMPTY_NEEDS;
  return {
    unassigned: {
      count: unassignedRes.count ?? 0,
      oldestDate: top?.scheduled_date ?? null,
      topReference: top?.reference_number ?? null,
    },
    notCompleted: {
      count: incompleteRes.count ?? 0,
      recent: (incompleteRes.data ?? []).map((r) => ({
        id: r.id as string,
        reference: (r.reference_number as string | null) ?? null,
        address: (r.address as string | null) ?? null,
      })),
    },
  };
}

/** Both at once, for the jobs home. */
export async function getProHomeData(tenantId: string, day: string): Promise<ProHomeData> {
  const [dayJobs, needs] = await Promise.all([getProDayJobs(tenantId, day), getProNeeds(tenantId, day)]);
  return { dayJobs, needs };
}
