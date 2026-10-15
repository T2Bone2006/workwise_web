import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, compareYmd, type Ymd } from '@/lib/rounds/dates';
import { getSoloWorkerForTenant } from '@/lib/rounds/rounds-worker';
import { RESCHEDULE_STATUSES } from '@/lib/rounds/visit-statuses';

export type StopsOnDayOff = { workerId: string; workerName: string; date: Ymd; visitCount: number };

const MAX_DAYS = 400;

/** Every day inside the given ranges, sorted and de-duplicated. A range longer than a year is cut off (the database allows 120 days). */
export function expandDaysOff(ranges: ReadonlyArray<{ from: Ymd; to: Ymd }>): Ymd[] {
  const days = new Set<Ymd>();
  for (const range of ranges) {
    let day = range.from;
    let guard = 0;
    while (compareYmd(day, range.to) <= 0 && guard < MAX_DAYS) {
      days.add(day);
      day = addDays(day, 1);
      guard += 1;
    }
  }
  return [...days].sort(compareYmd);
}

/**
 * Who still has open visits on a day they are off, between two dates. For the calendar warning and the Team today card.
 * Never throws: a read error gives [] (no warning rather than a wrong one).
 */
export async function findStopsOnDaysOff(
  db: SupabaseClient,
  tenantId: string,
  fromYmd: Ymd,
  toYmd: Ymd,
): Promise<StopsOnDayOff[]> {
  const { data: off, error } = await db
    .from('team_days_off')
    .select('worker_id, from_date, to_date')
    .eq('tenant_id', tenantId)
    .gte('to_date', fromYmd)
    .lte('from_date', toYmd);
  if (error || !Array.isArray(off) || off.length === 0) {
    if (error) console.error('[days-off] read:', error.message);
    return [];
  }

  const byWorker = new Map<string, Array<{ from: Ymd; to: Ymd }>>();
  for (const row of off as Array<{ worker_id: string; from_date: Ymd; to_date: Ymd }>) {
    const clipped = {
      from: compareYmd(row.from_date, fromYmd) < 0 ? fromYmd : row.from_date,
      to: compareYmd(row.to_date, toYmd) > 0 ? toYmd : row.to_date,
    };
    const list = byWorker.get(row.worker_id);
    if (list) list.push(clipped);
    else byWorker.set(row.worker_id, [clipped]);
  }

  const names = await workerNames(db, tenantId, [...byWorker.keys()]);
  const out: StopsOnDayOff[] = [];
  for (const [workerId, ranges] of byWorker) {
    const days = new Set(expandDaysOff(ranges));
    const sorted = [...days].sort(compareYmd);
    const { data: jobs, error: jobError } = await db
      .from('jobs')
      .select('scheduled_date')
      .eq('tenant_id', tenantId)
      .eq('assigned_worker_id', workerId)
      .in('status', [...RESCHEDULE_STATUSES])
      .gte('scheduled_date', sorted[0]!)
      .lte('scheduled_date', sorted[sorted.length - 1]!);
    if (jobError || !Array.isArray(jobs)) {
      if (jobError) console.error('[days-off] jobs:', jobError.message);
      continue;
    }
    const counts = new Map<Ymd, number>();
    for (const job of jobs as Array<{ scheduled_date: Ymd | null }>) {
      if (job.scheduled_date && days.has(job.scheduled_date)) {
        counts.set(job.scheduled_date, (counts.get(job.scheduled_date) ?? 0) + 1);
      }
    }
    for (const [date, visitCount] of [...counts].sort((a, b) => compareYmd(a[0], b[0]))) {
      out.push({ workerId, workerName: names.get(workerId) ?? 'Someone', date, visitCount });
    }
  }
  return out;
}

async function workerNames(db: SupabaseClient, tenantId: string, workerIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const solo = await getSoloWorkerForTenant(db, tenantId);
  if (solo) names.set(solo.id, 'You');
  if (workerIds.length === 0) return names;
  const { data } = await db
    .from('team_people')
    .select('worker_id, name')
    .eq('tenant_id', tenantId)
    .in('worker_id', workerIds);
  for (const row of (data ?? []) as Array<{ worker_id: string | null; name: string }>) {
    if (row.worker_id) names.set(row.worker_id, row.name);
  }
  return names;
}
