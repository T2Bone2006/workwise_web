import type { SupabaseClient } from '@supabase/supabase-js';
import { todayInLondon, type Ymd } from '@/lib/rounds/dates';
import { getSoloWorkerForTenant } from '@/lib/rounds/rounds-worker';
import { RESCHEDULE_STATUSES } from '@/lib/rounds/visit-statuses';
import { recordVisitChange, snapshotJobs, type JobSnapshot } from '@/lib/rounds/visit-changes';
import { writeHistory, type Actor } from '@/lib/rounds/visit-transitions';

/**
 * Who does which visit (D1, D12, T5). The plan is the visit's assigned_worker_id: generating a visit gives it to the
 * round's usual lead; giving a round to someone else for a day moves that day's open visits and writes one undoable
 * 'reassign' change. What actually happened (who worked) is the separate work_days record from Start day.
 *
 * Every function takes the SERVICE-ROLE client (or the owner's client, whose row security allows the owner) and a
 * tenantId from the owner's session; every query is filtered by it.
 */

export type Assignee = { workerId: string; name: string; isOwner: boolean };
export type AssignResult =
  | { success: true; moved: number; changeId: string | null }
  | { success: false; error: string };

export const CANNOT_TAKE_VISITS = "They can't take visits.";
const OPEN: readonly string[] = RESCHEDULE_STATUSES;

/** Who may receive a visit: the owner's own worker row, or a lead who has not been removed. Helpers never can. */
export async function validAssignees(db: SupabaseClient, tenantId: string): Promise<Assignee[]> {
  const out: Assignee[] = [];
  const solo = await getSoloWorkerForTenant(db, tenantId);
  if (solo) out.push({ workerId: solo.id, name: solo.full_name.trim() || 'You', isOwner: true });

  const { data: people, error } = await db
    .from('team_people')
    .select('name, worker_id')
    .eq('tenant_id', tenantId)
    .eq('kind', 'lead')
    .is('ended_at', null);
  if (error || !Array.isArray(people)) {
    console.error('[assign] leads:', error?.message);
    return out;
  }
  const ids = people.map((p) => (p as { worker_id: string | null }).worker_id).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return out;
  const { data: workers } = await db.from('workers').select('id, invite_status').in('id', ids);
  const live = new Set(
    ((workers ?? []) as Array<{ id: string; invite_status: string | null }>)
      .filter((w) => w.invite_status !== 'deactivated')
      .map((w) => w.id),
  );
  for (const p of people as Array<{ name: string; worker_id: string | null }>) {
    if (p.worker_id && live.has(p.worker_id)) out.push({ workerId: p.worker_id, name: p.name, isOwner: false });
  }
  return out;
}

/**
 * Give specific visits to one person. One undoable change (kind 'reassign'). Only open visits dated today or later
 * that are not already theirs move; anything else is left, so a replay moves nothing and records nothing.
 */
export async function reassignVisits(
  db: SupabaseClient,
  p: { tenantId: string; jobIds: string[]; toWorkerId: string; actor: Actor; today?: Ymd },
): Promise<AssignResult> {
  const jobIds = [...new Set(p.jobIds)];
  if (jobIds.length === 0) return { success: true, moved: 0, changeId: null };

  const assignees = await validAssignees(db, p.tenantId);
  const target = assignees.find((a) => a.workerId === p.toWorkerId);
  if (!target) return { success: false, error: CANNOT_TAKE_VISITS };

  const today = p.today ?? todayInLondon();
  const { data: jobs, error: readError } = await db
    .from('jobs')
    .select('id, status, scheduled_date, assigned_worker_id')
    .eq('tenant_id', p.tenantId)
    .in('id', jobIds);
  if (readError || !Array.isArray(jobs)) return { success: false, error: 'Could not load the visits. Try again.' };

  const eligible = (jobs as Array<{ id: string; status: string; scheduled_date: string | null; assigned_worker_id: string | null }>)
    .filter((j) => OPEN.includes(j.status) && j.scheduled_date != null && j.scheduled_date >= today && j.assigned_worker_id !== p.toWorkerId)
    .map((j) => j.id);
  if (eligible.length === 0) return { success: true, moved: 0, changeId: null };

  let before: JobSnapshot[];
  try {
    before = await snapshotJobs(db, p.tenantId, eligible);
  } catch {
    return { success: false, error: 'Could not load the visits. Try again.' };
  }

  const { data: changed, error: updateError } = await db
    .from('jobs')
    .update({ assigned_worker_id: p.toWorkerId, updated_at: new Date().toISOString() })
    .eq('tenant_id', p.tenantId)
    .in('id', eligible)
    .in('status', [...RESCHEDULE_STATUSES])
    .select('id');
  if (updateError) {
    console.error('[assign] reassign update:', updateError.message);
    return { success: false, error: 'Could not give those visits. Try again.' };
  }
  const movedIds = new Set((Array.isArray(changed) ? changed : []).map((r) => (r as { id: string }).id));
  if (movedIds.size === 0) return { success: true, moved: 0, changeId: null };

  const logged = before
    .filter((s) => movedIds.has(s.job_id))
    .map((s) => ({ ...s, after_worker_id: p.toWorkerId }));
  for (const snap of logged) {
    await writeHistory(db, {
      jobId: snap.job_id,
      fromStatus: snap.status,
      toStatus: snap.status,
      notes: `Given to ${target.name}`,
      metadata: { from: snap.assigned_worker_id ?? null, to: p.toWorkerId },
      actor: p.actor,
    });
  }
  const dates = logged.map((s) => s.scheduled_date).filter((d): d is string => Boolean(d)).sort();
  const changeId = await recordVisitChange(db, {
    tenantId: p.tenantId,
    kind: 'reassign',
    fromDate: dates[0] ?? today,
    toDate: null,
    jobIds: logged.map((s) => s.job_id),
    before: logged,
    notifyCustomers: false,
    actor: p.actor,
  });
  return { success: true, moved: logged.length, changeId };
}

/** Give everything open that `fromWorkerId` has on `date` (optionally only this round's) to `toWorkerId`. */
export async function giveRoundOnDay(
  db: SupabaseClient,
  p: { tenantId: string; date: Ymd; fromWorkerId: string; toWorkerId: string; roundId?: string | null; actor: Actor; today?: Ymd },
): Promise<AssignResult> {
  let agreementIds: string[] | null = null;
  if (p.roundId) {
    const { data, error } = await db
      .from('service_agreements')
      .select('id')
      .eq('tenant_id', p.tenantId)
      .eq('round_id', p.roundId);
    if (error || !Array.isArray(data)) return { success: false, error: 'Could not load the round. Try again.' };
    agreementIds = data.map((r) => (r as { id: string }).id);
    if (agreementIds.length === 0) return { success: true, moved: 0, changeId: null };
  }

  let query = db
    .from('jobs')
    .select('id')
    .eq('tenant_id', p.tenantId)
    .eq('assigned_worker_id', p.fromWorkerId)
    .eq('scheduled_date', p.date)
    .in('status', [...RESCHEDULE_STATUSES]);
  if (agreementIds) query = query.in('service_agreement_id', agreementIds);
  const { data, error } = await query;
  if (error || !Array.isArray(data)) return { success: false, error: 'Could not load the visits. Try again.' };

  return reassignVisits(db, {
    tenantId: p.tenantId,
    jobIds: data.map((r) => (r as { id: string }).id),
    toWorkerId: p.toWorkerId,
    actor: p.actor,
    today: p.today,
  });
}

/**
 * After a round's lead or members change: point the round's future open visits at its lead (or back at the owner).
 * Only visits currently with the PREVIOUS lead (or the owner, when there was none) move, so a visit the owner gave to
 * someone else for one day is never overwritten.
 */
export async function repointRoundVisits(
  db: SupabaseClient,
  p: { tenantId: string; roundId: string; previousLeadWorkerId: string | null; today?: Ymd },
): Promise<number> {
  const solo = await getSoloWorkerForTenant(db, p.tenantId);
  const { data: round, error: roundError } = await db
    .from('rounds')
    .select('usual_lead_worker_id')
    .eq('id', p.roundId)
    .eq('tenant_id', p.tenantId)
    .maybeSingle();
  if (roundError) return 0;
  const currentLead = (round as { usual_lead_worker_id?: string | null } | null)?.usual_lead_worker_id ?? null;

  const target = currentLead ?? solo?.id ?? null;
  const from = p.previousLeadWorkerId ?? solo?.id ?? null;
  if (!target || target === from) return 0;

  const { data: places, error: placesError } = await db
    .from('service_agreements')
    .select('id')
    .eq('tenant_id', p.tenantId)
    .eq('round_id', p.roundId);
  if (placesError || !Array.isArray(places) || places.length === 0) return 0;

  let query = db
    .from('jobs')
    .update({ assigned_worker_id: target, updated_at: new Date().toISOString() })
    .eq('tenant_id', p.tenantId)
    .in('service_agreement_id', places.map((r) => (r as { id: string }).id))
    .in('status', [...RESCHEDULE_STATUSES])
    .gte('scheduled_date', p.today ?? todayInLondon());
  query = from ? query.eq('assigned_worker_id', from) : query.is('assigned_worker_id', null);
  const { data, error } = await query.select('id');
  if (error) {
    console.error('[assign] repoint:', error.message);
    return 0;
  }
  return Array.isArray(data) ? data.length : 0;
}


/**
 * Places that left a round (or a round that was deleted): their future open visits that were with the round's lead go
 * back to the owner. Visits someone else holds for the day are left alone.
 */
export async function releaseVisitsToOwner(
  db: SupabaseClient,
  p: { tenantId: string; agreementIds: string[]; leadWorkerId: string | null; today?: Ymd },
): Promise<number> {
  if (!p.leadWorkerId || p.agreementIds.length === 0) return 0;
  const solo = await getSoloWorkerForTenant(db, p.tenantId);
  if (!solo || solo.id === p.leadWorkerId) return 0;
  const { data, error } = await db
    .from('jobs')
    .update({ assigned_worker_id: solo.id, updated_at: new Date().toISOString() })
    .eq('tenant_id', p.tenantId)
    .in('service_agreement_id', p.agreementIds)
    .eq('assigned_worker_id', p.leadWorkerId)
    .in('status', [...RESCHEDULE_STATUSES])
    .gte('scheduled_date', p.today ?? todayInLondon())
    .select('id');
  if (error) {
    console.error('[assign] release:', error.message);
    return 0;
  }
  return Array.isArray(data) ? data.length : 0;
}

/**
 * One place changed round: its future open visits that were with the old round's lead (or the owner, when that round
 * had none) go to the new round's lead (or the owner). Visits someone else holds for the day are left alone.
 */
export async function repointAgreementVisits(
  db: SupabaseClient,
  p: { tenantId: string; agreementId: string; fromLeadWorkerId: string | null; toLeadWorkerId: string | null; today?: Ymd },
): Promise<number> {
  const solo = await getSoloWorkerForTenant(db, p.tenantId);
  const from = p.fromLeadWorkerId ?? solo?.id ?? null;
  const target = p.toLeadWorkerId ?? solo?.id ?? null;
  if (!target || target === from) return 0;
  let query = db
    .from('jobs')
    .update({ assigned_worker_id: target, updated_at: new Date().toISOString() })
    .eq('tenant_id', p.tenantId)
    .eq('service_agreement_id', p.agreementId)
    .in('status', [...RESCHEDULE_STATUSES])
    .gte('scheduled_date', p.today ?? todayInLondon());
  query = from ? query.eq('assigned_worker_id', from) : query.is('assigned_worker_id', null);
  const { data, error } = await query.select('id');
  if (error) {
    console.error('[assign] repoint agreement:', error.message);
    return 0;
  }
  return Array.isArray(data) ? data.length : 0;
}

/** Set (or clear with null) a round's usual lead and re-point its future planned visits. The owner can be the lead: stored as null. */
export async function setUsualLead(
  db: SupabaseClient,
  p: { tenantId: string; roundId: string; workerId: string | null; today?: Ymd },
): Promise<{ success: true; repointed: number } | { success: false; error: string }> {
  const { data: round, error: readError } = await db
    .from('rounds')
    .select('id, usual_lead_worker_id')
    .eq('id', p.roundId)
    .eq('tenant_id', p.tenantId)
    .maybeSingle();
  if (readError) return { success: false, error: 'Could not load the round. Try again.' };
  if (!round) return { success: false, error: 'That round doesn’t exist.' };
  const previous = (round as { usual_lead_worker_id: string | null }).usual_lead_worker_id ?? null;

  let next = p.workerId;
  if (next) {
    const assignees = await validAssignees(db, p.tenantId);
    const found = assignees.find((a) => a.workerId === next);
    if (!found) return { success: false, error: CANNOT_TAKE_VISITS };
    if (found.isOwner) next = null;
  }

  const { error } = await db
    .from('rounds')
    .update({ usual_lead_worker_id: next, updated_at: new Date().toISOString() })
    .eq('id', p.roundId)
    .eq('tenant_id', p.tenantId);
  if (error) {
    console.error('[assign] setUsualLead:', error.message);
    return { success: false, error: 'Could not save that. Try again.' };
  }
  const repointed = await repointRoundVisits(db, { tenantId: p.tenantId, roundId: p.roundId, previousLeadWorkerId: previous, today: p.today });
  return { success: true, repointed };
}


