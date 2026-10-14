import type { SupabaseClient } from '@supabase/supabase-js';
import type { Ymd } from '@/lib/rounds/dates';
import type { DayOff, TeamPerson } from './types';

type PersonRow = {
  id: string;
  kind: 'lead' | 'helper';
  name: string;
  day_rate_pence: number | null;
  usual_days: number[] | null;
  worker_id: string | null;
  ended_at: string | null;
};
type WorkerRow = { id: string; invite_status: string | null; email: string | null; phone: string | null };

function inviteStatus(value: string | null | undefined): TeamPerson['inviteStatus'] {
  return value === 'pending' || value === 'accepted' || value === 'deactivated' ? value : null;
}

/** Everyone on the team: active first (leads before helpers, then A–Z), ended people last. Never throws; an error gives []. */
export async function listTeam(db: SupabaseClient, tenantId: string): Promise<TeamPerson[]> {
  const { data, error } = await db
    .from('team_people')
    .select('id, kind, name, day_rate_pence, usual_days, worker_id, ended_at')
    .eq('tenant_id', tenantId);
  if (error || !Array.isArray(data)) {
    console.error('[team] listTeam', error?.message);
    return [];
  }
  const people = data as PersonRow[];

  const workerIds = people.map((p) => p.worker_id).filter((id): id is string => Boolean(id));
  const workers = new Map<string, WorkerRow>();
  if (workerIds.length > 0) {
    const { data: workerRows, error: workerError } = await db
      .from('workers')
      .select('id, invite_status, email, phone')
      .in('id', workerIds);
    if (workerError) console.error('[team] listTeam workers', workerError.message);
    for (const w of (workerRows ?? []) as WorkerRow[]) workers.set(w.id, w);
  }

  const mapped: TeamPerson[] = people.map((p) => {
    const worker = p.worker_id ? workers.get(p.worker_id) : undefined;
    return {
      id: p.id,
      kind: p.kind,
      name: p.name,
      dayRatePence: p.day_rate_pence ?? 0,
      usualDays: Array.isArray(p.usual_days) ? p.usual_days.map(Number) : [1, 2, 3, 4, 5],
      workerId: p.worker_id,
      inviteStatus: p.kind === 'lead' ? inviteStatus(worker?.invite_status) : null,
      email: worker?.email ?? null,
      phone: worker?.phone ?? null,
      endedAt: p.ended_at,
    };
  });

  return mapped.sort((a, b) => {
    const ended = Number(Boolean(a.endedAt)) - Number(Boolean(b.endedAt));
    if (ended !== 0) return ended;
    if (a.kind !== b.kind) return a.kind === 'lead' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** Days off that end today or later, soonest first. */
export async function listDaysOff(db: SupabaseClient, tenantId: string, fromYmd: Ymd): Promise<DayOff[]> {
  const { data, error } = await db
    .from('team_days_off')
    .select('id, worker_id, from_date, to_date, note')
    .eq('tenant_id', tenantId)
    .gte('to_date', fromYmd)
    .order('from_date', { ascending: true });
  if (error || !Array.isArray(data)) {
    console.error('[team] listDaysOff', error?.message);
    return [];
  }
  return data.map((r) => {
    const row = r as { id: string; worker_id: string; from_date: string; to_date: string; note: string | null };
    return { id: row.id, workerId: row.worker_id, from: row.from_date, to: row.to_date, note: row.note };
  });
}
