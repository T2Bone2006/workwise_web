import 'server-only';

import { teamPricePence } from '@/lib/billing/rounds-team-core';
import { countBilledLeads, shapePeople, type TeamPageData, type TeamPageRound } from '@/lib/data/team-page-core';
import { todayInLondon } from '@/lib/rounds/dates';
import { createAdminClient } from '@/lib/supabase/admin';
import { listHeldCash } from '@/lib/team/hand-in';
import { validAssignees } from '@/lib/team/assign';
import { checkPlan } from '@/lib/team/invite-lead';
import { listDaysOff, listTeam } from '@/lib/team/team-read';

const HIDDEN_STATUSES = ['pending', 'pending_send'] as const;

/**
 * Everything the Team page shows, for the owner's business. Takes the tenant from the caller (the page has
 * already checked the owner) and reads with the service-role client because the staff lock (step 5) closes the
 * business's tables to a login that is not the owner. A failed read leaves that part empty rather than throwing.
 */
export async function getTeamPageData(tenantId: string): Promise<TeamPageData> {
  const db = createAdminClient();
  const today = todayInLondon();

  const [people, daysOff, roundsRes, jobsRes, workedRes, held, plan, assignees] = await Promise.all([
    listTeam(db, tenantId),
    listDaysOff(db, tenantId, today),
    db.from('rounds').select('id, name, colour, usual_lead_worker_id').eq('tenant_id', tenantId).order('name'),
    db
      .from('jobs')
      .select('assigned_worker_id, status')
      .eq('tenant_id', tenantId)
      .eq('scheduled_date', today)
      .not('assigned_worker_id', 'is', null)
      .not('status', 'in', `(${HIDDEN_STATUSES.join(',')})`),
    db.from('work_days').select('person_id').eq('tenant_id', tenantId).eq('work_date', today),
    listHeldCash(db, tenantId, today).catch(() => []),
    checkPlan(db, tenantId),
    validAssignees(db, tenantId).catch(() => []),
  ]);

  const rounds: TeamPageRound[] = ((roundsRes.data ?? []) as Array<{
    id: string;
    name: string;
    colour: string;
    usual_lead_worker_id: string | null;
  }>).map((r) => ({ id: r.id, name: r.name, colour: r.colour, usualLeadWorkerId: r.usual_lead_worker_id }));

  const stops = new Map<string, { total: number; done: number }>();
  for (const row of (jobsRes.data ?? []) as Array<{ assigned_worker_id: string; status: string }>) {
    const entry = stops.get(row.assigned_worker_id) ?? { total: 0, done: 0 };
    entry.total += 1;
    if (row.status === 'completed') entry.done += 1;
    stops.set(row.assigned_worker_id, entry);
  }

  const workedToday = new Set(((workedRes.data ?? []) as Array<{ person_id: string }>).map((r) => r.person_id));

  const heldByWorker = new Map<string, number>();
  let heldTotalPence = 0;
  for (const group of held) {
    const pence = Math.round(group.total * 100);
    heldTotalPence += pence;
    if (group.workerId) heldByWorker.set(group.workerId, pence);
  }

  const leadCount = countBilledLeads(people);
  const interval = plan.ok ? plan.interval : null;

  return {
    people: shapePeople({ people, daysOff, rounds, stops, workedToday, heldByWorker, today }),
    rounds,
    billing: {
      canAddLeads: plan.ok,
      reason: plan.ok ? null : plan.error,
      perLeadPence: teamPricePence(interval ?? 'month'),
      interval,
      leadCount,
    },
    heldTotalPence,
    assignees,
    daysOffAll: daysOff,
  };
}
