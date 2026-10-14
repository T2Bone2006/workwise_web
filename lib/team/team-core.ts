import type { SupabaseClient } from '@supabase/supabase-js';
import { reconcileRoundsTeamAfterChange } from '@/lib/billing/rounds-team';
import { todayInLondon, type Ymd } from '@/lib/rounds/dates';
import { getSoloWorkerForTenant } from '@/lib/rounds/rounds-worker';
import { RESCHEDULE_STATUSES } from '@/lib/rounds/visit-statuses';
import type { DayOffInput, HelperInput } from '@/lib/validations/team';
import type { TeamResult } from './types';

/**
 * Writes to the team. Every function takes the SERVICE-ROLE client and a tenantId that the caller took from the
 * owner's session (the server actions call requireOwner() first); every query is filtered by that tenantId, so an id
 * from another business changes nothing. Helpers are never `workers` rows (so they are never counted or charged).
 */

const NOT_FOUND = 'Not found.';

type PersonRow = {
  id: string;
  kind: 'lead' | 'helper';
  name: string;
  worker_id: string | null;
  ended_at: string | null;
};

async function loadPerson(db: SupabaseClient, tenantId: string, personId: string): Promise<PersonRow | null> {
  const { data, error } = await db
    .from('team_people')
    .select('id, kind, name, worker_id, ended_at')
    .eq('id', personId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error || !data) return null;
  return data as PersonRow;
}

async function activeNames(db: SupabaseClient, tenantId: string): Promise<{ id: string; name: string }[] | null> {
  const { data, error } = await db
    .from('team_people')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .is('ended_at', null);
  if (error) return null;
  return (data ?? []) as { id: string; name: string }[];
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export async function addHelper(
  db: SupabaseClient,
  tenantId: string,
  input: Pick<HelperInput, 'name' | 'usualDays'> & { dayRatePence: number },
): Promise<TeamResult<{ id: string }>> {
  const names = await activeNames(db, tenantId);
  if (!names) return { ok: false, error: 'Could not check your team. Try again.' };
  if (names.some((n) => sameName(n.name, input.name))) {
    return { ok: false, error: `A person called ${input.name.trim()} already exists.` };
  }
  const { data, error } = await db
    .from('team_people')
    .insert({
      tenant_id: tenantId,
      kind: 'helper',
      worker_id: null,
      name: input.name.trim(),
      day_rate_pence: input.dayRatePence,
      usual_days: input.usualDays,
    })
    .select('id')
    .single();
  if (error || !data) {
    console.error('[team] addHelper', error?.message);
    return { ok: false, error: 'Could not add them. Try again.' };
  }
  return { ok: true, id: (data as { id: string }).id };
}

export async function updatePerson(
  db: SupabaseClient,
  tenantId: string,
  personId: string,
  patch: { name?: string; dayRatePence?: number; usualDays?: number[] },
): Promise<TeamResult> {
  const person = await loadPerson(db, tenantId, personId);
  if (!person) return { ok: false, error: NOT_FOUND };

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name === '') return { ok: false, error: 'Enter a name.' };
    const names = await activeNames(db, tenantId);
    if (!names) return { ok: false, error: 'Could not check your team. Try again.' };
    if (names.some((n) => n.id !== personId && sameName(n.name, name))) {
      return { ok: false, error: `A person called ${name} already exists.` };
    }
    update.name = name;
  }
  if (patch.dayRatePence !== undefined) update.day_rate_pence = patch.dayRatePence;
  if (patch.usualDays !== undefined) update.usual_days = patch.usualDays;

  const { error } = await db.from('team_people').update(update).eq('id', personId).eq('tenant_id', tenantId);
  if (error) {
    console.error('[team] updatePerson', error.message);
    return { ok: false, error: 'Could not save that. Try again.' };
  }
  return { ok: true };
}

export const setDayRate = (db: SupabaseClient, tenantId: string, personId: string, dayRatePence: number) =>
  updatePerson(db, tenantId, personId, { dayRatePence });

export const setUsualDays = (db: SupabaseClient, tenantId: string, personId: string, usualDays: number[]) =>
  updatePerson(db, tenantId, personId, { usualDays });

/** A helper stops being offered; their past days and pay stay. Leads are removed with removeLead. */
export async function endHelper(db: SupabaseClient, tenantId: string, personId: string): Promise<TeamResult> {
  const person = await loadPerson(db, tenantId, personId);
  if (!person || person.kind !== 'helper') return { ok: false, error: NOT_FOUND };
  if (person.ended_at) return { ok: true };
  const { error } = await db
    .from('team_people')
    .update({ ended_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', personId)
    .eq('tenant_id', tenantId);
  if (error) {
    console.error('[team] endHelper', error.message);
    return { ok: false, error: 'Could not remove them. Try again.' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Days off (a lead, or the owner's own worker)

async function workerBelongsToTenant(db: SupabaseClient, tenantId: string, workerId: string): Promise<boolean> {
  const { data, error } = await db
    .from('workers')
    .select('id, primary_tenant_id, invite_status')
    .eq('id', workerId)
    .eq('primary_tenant_id', tenantId)
    .maybeSingle();
  if (error || !data) return false;
  return (data as { invite_status?: string | null }).invite_status !== 'deactivated';
}

export async function addDayOff(
  db: SupabaseClient,
  tenantId: string,
  input: DayOffInput,
): Promise<TeamResult<{ id: string; alreadySaved: boolean }>> {
  if (!(await workerBelongsToTenant(db, tenantId, input.workerId))) return { ok: false, error: NOT_FOUND };

  const { data: existing, error: readError } = await db
    .from('team_days_off')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('worker_id', input.workerId)
    .eq('from_date', input.from)
    .eq('to_date', input.to)
    .maybeSingle();
  if (readError) return { ok: false, error: 'Could not save that. Try again.' };
  if (existing) return { ok: true, id: (existing as { id: string }).id, alreadySaved: true };

  const { data, error } = await db
    .from('team_days_off')
    .insert({
      tenant_id: tenantId,
      worker_id: input.workerId,
      from_date: input.from,
      to_date: input.to,
      note: input.note ? input.note : null,
    })
    .select('id')
    .single();
  if (error || !data) {
    console.error('[team] addDayOff', error?.message);
    return { ok: false, error: 'Could not save that. Try again.' };
  }
  return { ok: true, id: (data as { id: string }).id, alreadySaved: false };
}

export async function removeDayOff(db: SupabaseClient, tenantId: string, id: string): Promise<TeamResult> {
  const { error } = await db.from('team_days_off').delete().eq('id', id).eq('tenant_id', tenantId);
  if (error) {
    console.error('[team] removeDayOff', error.message);
    return { ok: false, error: 'Could not remove that. Try again.' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Removing a lead

export type RemoveLeadResult = { loggedOut: boolean; visitsReturned: number; heldCashPence: number };

const BAN_FOREVER = '876000h';

/**
 * Cuts a lead off at once (D14): login banned, the worker row deactivated, the team person ended, their future
 * open visits handed back to the owner, the round "usual lead" cleared, and the £10 line reconciled. Their
 * history, pay and any cash they hold stay on record (the held cash total is returned, not changed).
 * Safe to run twice. If the login cannot be switched off nothing else is changed, so the owner can simply try again.
 */
export async function removeLead(
  db: SupabaseClient,
  tenantId: string,
  personId: string,
  opts: { at?: Date } = {},
): Promise<TeamResult<RemoveLeadResult>> {
  const person = await loadPerson(db, tenantId, personId);
  if (!person || person.kind !== 'lead') return { ok: false, error: NOT_FOUND };
  if (person.ended_at) {
    return { ok: true, loggedOut: true, visitsReturned: 0, heldCashPence: await heldCashPence(db, tenantId, person) };
  }

  const at = opts.at ?? new Date();
  let loggedOut = false;

  if (person.worker_id) {
    const { data: worker, error: workerError } = await db
      .from('workers')
      .select('id, user_id')
      .eq('id', person.worker_id)
      .eq('primary_tenant_id', tenantId)
      .maybeSingle();
    if (workerError) return { ok: false, error: "Couldn't switch off their login. Nothing was changed." };

    const userId = (worker as { user_id?: string | null } | null)?.user_id ?? null;
    if (userId) {
      const { error: banError } = await db.auth.admin.updateUserById(userId, { ban_duration: BAN_FOREVER });
      if (banError) {
        console.error('[team] removeLead ban', banError.message);
        return { ok: false, error: "Couldn't switch off their login. Nothing was changed." };
      }
      loggedOut = true;
    }

    const { error: deactivateError } = await db
      .from('workers')
      .update({ invite_status: 'deactivated', status: 'unavailable', updated_at: at.toISOString() })
      .eq('id', person.worker_id)
      .eq('primary_tenant_id', tenantId);
    if (deactivateError) {
      console.error('[team] removeLead deactivate', deactivateError.message);
      return { ok: false, error: "Couldn't finish removing them. Try again." };
    }
  }

  const { error: endError } = await db
    .from('team_people')
    .update({ ended_at: at.toISOString(), updated_at: at.toISOString() })
    .eq('id', personId)
    .eq('tenant_id', tenantId);
  if (endError) {
    console.error('[team] removeLead end', endError.message);
    return { ok: false, error: "Couldn't finish removing them. Try again." };
  }

  let visitsReturned = 0;
  if (person.worker_id) {
    visitsReturned = await returnVisitsToOwner(db, tenantId, person.worker_id, todayInLondon(at));

    const { error: roundError } = await db
      .from('rounds')
      .update({ usual_lead_worker_id: null })
      .eq('tenant_id', tenantId)
      .eq('usual_lead_worker_id', person.worker_id);
    if (roundError) console.error('[team] removeLead rounds', roundError.message);
  }

  const heldCash = await heldCashPence(db, tenantId, person);
  reconcileRoundsTeamAfterChange(tenantId);
  return { ok: true, loggedOut: loggedOut || !person.worker_id, visitsReturned, heldCashPence: heldCash };
}

async function returnVisitsToOwner(
  db: SupabaseClient,
  tenantId: string,
  workerId: string,
  today: Ymd,
): Promise<number> {
  const solo = await getSoloWorkerForTenant(db, tenantId);
  if (!solo) {
    console.error('[team] removeLead: no owner worker row to give the visits back to');
    return 0;
  }
  const { data, error } = await db
    .from('jobs')
    .update({ assigned_worker_id: solo.id })
    .eq('tenant_id', tenantId)
    .eq('assigned_worker_id', workerId)
    .in('status', [...RESCHEDULE_STATUSES])
    .gte('scheduled_date', today)
    .select('id');
  if (error) {
    console.error('[team] removeLead visits', error.message);
    return 0;
  }
  return Array.isArray(data) ? data.length : 0;
}

async function heldCashPence(db: SupabaseClient, tenantId: string, person: PersonRow): Promise<number> {
  if (!person.worker_id) return 0;
  const { data, error } = await db
    .from('payments')
    .select('amount')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .eq('collected_by_worker_id', person.worker_id)
    .is('handed_over_at', null);
  if (error || !Array.isArray(data)) return 0;
  return data.reduce((sum, row) => sum + Math.round(Number((row as { amount?: unknown }).amount ?? 0) * 100), 0);
}
