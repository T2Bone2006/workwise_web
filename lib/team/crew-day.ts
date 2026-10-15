import type { SupabaseClient } from '@supabase/supabase-js';
import { diffDays, todayInLondon, type Ymd } from '@/lib/rounds/dates';

/**
 * Start day (D3, D4, T6): recording who worked today. The lead (or the owner, who has no pay row of their own) and
 * anyone they went out with get one work_days row each, with the day rate copied at that moment. The people with
 * them can be helpers, or another lead who is helping that day. One row per person per date (the database enforces
 * it), so pressing Start day twice, or replaying a queued one, changes nothing, and a lead who already has a day
 * is not paid twice.
 */

export type CrewDayResult =
  | { ok: true; recorded: Array<{ personId: string; name: string; role: 'lead' | 'helper'; ratePence: number }>; changed: boolean }
  | { ok: false; error: string };

/** A Start day queued with no signal may arrive the next morning, so a couple of days either side of today is accepted. */
const DATE_WINDOW_DAYS = 2;

type PersonRow = { id: string; name: string; day_rate_pence: number };

export async function recordCrewDay(
  db: SupabaseClient,
  p: {
    tenantId: string;
    date: Ymd;
    /** The lead's team_people id; null when the owner is starting their own day. */
    leadPersonId: string | null;
    helperIds: string[];
    today?: Ymd;
  },
): Promise<CrewDayResult> {
  const today = p.today ?? todayInLondon();
  if (Math.abs(diffDays(today, p.date)) > DATE_WINDOW_DAYS) {
    return { ok: false, error: 'That date is too far from today.' };
  }
  const helperIds = [...new Set(p.helperIds)];
  if (p.leadPersonId && helperIds.includes(p.leadPersonId)) {
    return { ok: false, error: 'Pick helpers from your team list.' };
  }

  let lead: PersonRow | null = null;
  if (p.leadPersonId) {
    const { data, error } = await db
      .from('team_people')
      .select('id, name, day_rate_pence')
      .eq('id', p.leadPersonId)
      .eq('tenant_id', p.tenantId)
      .eq('kind', 'lead')
      .is('ended_at', null)
      .maybeSingle();
    if (error) return { ok: false, error: 'Could not start the day. Try again.' };
    if (!data) return { ok: false, error: 'Not found.' };
    lead = data as PersonRow;
  }

  let helpers: PersonRow[] = [];
  if (helperIds.length > 0) {
    const { data, error } = await db
      .from('team_people')
      .select('id, name, day_rate_pence, kind')
      .eq('tenant_id', p.tenantId)
      .is('ended_at', null)
      .in('id', helperIds);
    if (error) return { ok: false, error: 'Could not start the day. Try again.' };
    helpers = ((data ?? []) as Array<PersonRow & { kind: string }>).filter(
      (row) => (row.kind === 'helper' || row.kind === 'lead') && row.id !== p.leadPersonId,
    );
    if (helpers.length !== helperIds.length) return { ok: false, error: 'Pick helpers from your team list.' };
  }

  const wanted: Array<Record<string, unknown>> = [];
  if (lead) {
    wanted.push({
      tenant_id: p.tenantId, work_date: p.date, person_id: lead.id, role: 'lead',
      rate_pence: lead.day_rate_pence, source: 'start_day', with_person_id: null,
    });
  }
  for (const helper of helpers) {
    wanted.push({
      tenant_id: p.tenantId, work_date: p.date, person_id: helper.id, role: 'helper',
      rate_pence: helper.day_rate_pence, source: 'start_day', with_person_id: lead?.id ?? null,
    });
  }

  let inserted = 0;
  if (wanted.length > 0) {
    const { data, error } = await db
      .from('work_days')
      .upsert(wanted, { onConflict: 'tenant_id,work_date,person_id', ignoreDuplicates: true })
      .select('id');
    if (error) {
      console.error('[crew-day] upsert:', error.message);
      return { ok: false, error: 'Could not start the day. Try again.' };
    }
    inserted = Array.isArray(data) ? data.length : 0;
  }

  // A correction of the same day: helpers THIS start recorded earlier who are no longer chosen are taken off again.
  // A day the owner added by hand (source 'manual') or one recorded by a different lead's start is never touched.
  let removed = 0;
  const { data: mine, error: mineError } = await db
    .from('work_days')
    .select('id, person_id, with_person_id')
    .eq('tenant_id', p.tenantId)
    .eq('work_date', p.date)
    .eq('role', 'helper')
    .eq('source', 'start_day');
  if (mineError) {
    console.error('[crew-day] read:', mineError.message);
  } else {
    const stale = ((mine ?? []) as Array<{ id: string; person_id: string; with_person_id: string | null }>).filter(
      (row) => (row.with_person_id ?? null) === (lead?.id ?? null) && !helperIds.includes(row.person_id),
    );
    for (const row of stale) {
      const { error } = await db.from('work_days').delete().eq('id', row.id).eq('tenant_id', p.tenantId);
      if (error) console.error('[crew-day] remove:', error.message);
      else removed += 1;
    }
  }

  const recorded: Array<{ personId: string; name: string; role: 'lead' | 'helper'; ratePence: number }> = [];
  if (lead) recorded.push({ personId: lead.id, name: lead.name, role: 'lead', ratePence: lead.day_rate_pence });
  for (const helper of helpers) recorded.push({ personId: helper.id, name: helper.name, role: 'helper', ratePence: helper.day_rate_pence });
  return { ok: true, recorded, changed: inserted + removed > 0 };
}

/**
 * Who this lead (or the owner, with null) last went out with: from their most recent day that had company,
 * including today if they have already started. Only people still on the team, leads or helpers. Empty until there is one.
 */
export async function lastHelperIds(db: SupabaseClient, tenantId: string, leadPersonId: string | null): Promise<string[]> {
  let query = db
    .from('work_days')
    .select('person_id, work_date')
    .eq('tenant_id', tenantId)
    .eq('role', 'helper')
    .eq('source', 'start_day')
    .order('work_date', { ascending: false })
    .limit(60);
  query = leadPersonId ? query.eq('with_person_id', leadPersonId) : query.is('with_person_id', null);
  const { data, error } = await query;
  if (error || !Array.isArray(data) || data.length === 0) return [];
  const rows = data as Array<{ person_id: string; work_date: Ymd }>;
  const latest = rows[0]!.work_date;
  const ids = rows.filter((r) => r.work_date === latest).map((r) => r.person_id);

  const { data: active } = await db
    .from('team_people')
    .select('id')
    .eq('tenant_id', tenantId)
    .is('ended_at', null)
    .in('id', ids);
  const live = new Set(((active ?? []) as Array<{ id: string }>).map((r) => r.id));
  return ids.filter((id) => live.has(id));
}
