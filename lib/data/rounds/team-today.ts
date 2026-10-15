import 'server-only';

import { shapeTeamToday, type TeamToday } from '@/lib/data/rounds/team-today-core';
import { addDays, isoWeekday, londonDayBoundsUtc, type Ymd } from '@/lib/rounds/dates';
import { getSoloWorkerForTenant } from '@/lib/rounds/rounds-worker';
import { createAdminClient } from '@/lib/supabase/admin';
import { listHeldCash } from '@/lib/team/hand-in';
import { weekSummary } from '@/lib/team/pay';
import { listDaysOff, listTeam } from '@/lib/team/team-read';

const HIDDEN_STATUSES = ['pending', 'pending_send'] as const;

function londonHour(now: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/London' }).format(now));
}

/**
 * The Dashboard's Team today card, in one pass (no per-person queries). Null when there is no team and no held cash,
 * so a solo trader's Dashboard is unchanged. Uses the service-role client (the staff lock closes these tables to a
 * login that is not the owner); the caller took the business from the owner's session. Throws if a read fails; the
 * Dashboard catches it and leaves the card out.
 */
export async function getTeamToday(tenantId: string, today: Ymd, now: Date = new Date()): Promise<TeamToday | null> {
  const db = createAdminClient();
  const bounds = londonDayBoundsUtc(today);
  const weekStart = addDays(today, -(isoWeekday(today) - 1));

  const [people, daysOff, jobsRes, takenRes, held, workedRes, solo, weekDays] = await Promise.all([
    listTeam(db, tenantId),
    listDaysOff(db, tenantId, today),
    db
      .from('jobs')
      .select('assigned_worker_id, status')
      .eq('tenant_id', tenantId)
      .eq('scheduled_date', today)
      .not('assigned_worker_id', 'is', null)
      .not('status', 'in', `(${HIDDEN_STATUSES.join(',')})`),
    db
      .from('payments')
      .select('collected_by_worker_id, amount')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .not('collected_by_worker_id', 'is', null)
      .gte('received_at', bounds.startIso)
      .lt('received_at', bounds.endIso),
    listHeldCash(db, tenantId, today),
    db.from('work_days').select('person_id, role, with_person_id').eq('tenant_id', tenantId).eq('work_date', today),
    getSoloWorkerForTenant(db, tenantId),
    weekSummary(db, tenantId, weekStart),
  ]);
  if (jobsRes.error) throw new Error('Could not load today’s visits.');

  const takenByWorker = new Map<string, number>();
  for (const row of (takenRes.data ?? []) as Array<{ collected_by_worker_id: string; amount: number | string }>) {
    takenByWorker.set(row.collected_by_worker_id, Math.round(((takenByWorker.get(row.collected_by_worker_id) ?? 0) + Number(row.amount)) * 100) / 100);
  }

  const work = (workedRes.data ?? []) as Array<{ person_id: string; role: 'lead' | 'helper'; with_person_id: string | null }>;
  const nameById = new Map(people.map((p) => [p.id, p.name]));

  return shapeTeamToday({
    today,
    hour: londonHour(now),
    people,
    owner: solo ? { workerId: solo.id, name: solo.full_name } : null,
    daysOff,
    jobs: ((jobsRes.data ?? []) as Array<{ assigned_worker_id: string; status: string }>).map((j) => ({ workerId: j.assigned_worker_id, status: j.status })),
    takenByWorker,
    held: held.map((g) => ({ workerId: g.workerId, name: g.name, total: g.total })),
    workedPersonIds: new Set(work.map((w) => w.person_id)),
    helperRows: work.filter((w) => w.role === 'helper').map((w) => ({ helperName: nameById.get(w.person_id) ?? 'Helper', withPersonId: w.with_person_id })),
    weekDays: weekDays.map((d) => ({ name: d.name, days: d.days, earned: d.earnedPence / 100 })),
  });
}
