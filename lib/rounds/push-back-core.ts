import type { SupabaseClient } from '@supabase/supabase-js';
import { getRoundsSettings } from '@/lib/data/rounds/settings';
import { compareYmd, todayInLondon, type Ymd } from '@/lib/rounds/dates';
import { planPushBack, type PushBackPlan, type PushBackVisit } from '@/lib/rounds/push-back';
import { horizonEnd } from '@/lib/rounds/recurrence';
import { RESCHEDULE_STATUSES } from '@/lib/rounds/visit-statuses';
import { finishLoggedChange, snapshotJobs, type JobSnapshot } from '@/lib/rounds/visit-changes';
import { writeHistory, type Actor } from '@/lib/rounds/visit-transitions';
import { expandDaysOff } from '@/lib/team/days-off';

/**
 * Push back for one person across some days off (D11): loads their open visits, plans the slide with the pure
 * planPushBack, and applies it as ONE undoable change (kind 'push_back'). It moves visits only: it never changes an
 * agreement's next due date, never regenerates visits, and never texts anyone (Tell them is the owner's choice).
 */

export type PushBackPreview = {
  plan: PushBackPlan;
  lastDate: Ymd | null;
  /** The first few moves with the customer's name, for the confirmation screen. */
  sample: Array<{ customerName: string; from: Ymd; to: Ymd }>;
};

type JobRow = {
  id: string;
  scheduled_date: Ymd;
  route_position: number | null;
  service_agreement_id: string | null;
  customer_id: string | null;
};

type Loaded =
  | { ok: true; plan: PushBackPlan; jobs: Map<string, JobRow> }
  | { ok: false; error: string };

async function loadPlan(
  db: SupabaseClient,
  p: { tenantId: string; workerId: string; offFrom: Ymd; offTo: Ymd; today?: Ymd },
): Promise<Loaded> {
  const today = p.today ?? todayInLondon();
  if (compareYmd(p.offTo, today) < 0) return { ok: false, error: 'Those days have already passed.' };
  const start = compareYmd(p.offFrom, today) < 0 ? today : p.offFrom;

  const settings = await getRoundsSettings(db, p.tenantId);
  const lastDay = horizonEnd(today, settings);

  const { data: person } = await db
    .from('team_people')
    .select('usual_days')
    .eq('tenant_id', p.tenantId)
    .eq('worker_id', p.workerId)
    .eq('kind', 'lead')
    .maybeSingle();
  const personDays = (person as { usual_days?: number[] | null } | null)?.usual_days;
  const workingDays = Array.isArray(personDays) && personDays.length > 0 ? personDays.map(Number) : settings.working_days;

  const { data: offRows, error: offError } = await db
    .from('team_days_off')
    .select('from_date, to_date')
    .eq('tenant_id', p.tenantId)
    .eq('worker_id', p.workerId)
    .gte('to_date', start);
  if (offError) return { ok: false, error: 'Could not load their days off. Try again.' };
  const ranges = [
    ...((offRows ?? []) as Array<{ from_date: Ymd; to_date: Ymd }>).map((r) => ({ from: r.from_date, to: r.to_date })),
    { from: p.offFrom, to: p.offTo },
  ];

  const { data: jobRows, error: jobError } = await db
    .from('jobs')
    .select('id, scheduled_date, route_position, service_agreement_id, customer_id')
    .eq('tenant_id', p.tenantId)
    .eq('assigned_worker_id', p.workerId)
    .in('status', [...RESCHEDULE_STATUSES])
    .gte('scheduled_date', start)
    .lte('scheduled_date', lastDay);
  if (jobError || !Array.isArray(jobRows)) return { ok: false, error: 'Could not load their visits. Try again.' };
  const jobs = new Map<string, JobRow>();
  for (const row of jobRows as JobRow[]) if (row.scheduled_date) jobs.set(row.id, row);

  const nextByAgreement = await nextVisitDates(db, p.tenantId, [...jobs.values()], start);
  const visits: PushBackVisit[] = [...jobs.values()].map((job) => ({
    id: job.id,
    date: job.scheduled_date,
    position: job.route_position,
    agreementId: job.service_agreement_id,
    nextVisitDate: job.service_agreement_id ? nextAfter(nextByAgreement.get(job.service_agreement_id), job.scheduled_date) : null,
  }));

  const plan = planPushBack({
    visits,
    offDays: expandDaysOff(ranges),
    workingDays,
    blackouts: settings.blackouts,
    lastDay,
  });
  return { ok: true, plan, jobs };
}

/** For each agreement: the dates of its open visits (any assignee) from `start`, plus its next due date, all sorted. */
async function nextVisitDates(
  db: SupabaseClient,
  tenantId: string,
  jobs: JobRow[],
  start: Ymd,
): Promise<Map<string, Ymd[]>> {
  const result = new Map<string, Ymd[]>();
  const agreementIds = [...new Set(jobs.map((j) => j.service_agreement_id).filter((id): id is string => Boolean(id)))];
  if (agreementIds.length === 0) return result;

  const { data: dated } = await db
    .from('jobs')
    .select('service_agreement_id, scheduled_date')
    .eq('tenant_id', tenantId)
    .in('service_agreement_id', agreementIds)
    .in('status', [...RESCHEDULE_STATUSES])
    .gte('scheduled_date', start);
  const { data: agreements } = await db
    .from('service_agreements')
    .select('id, next_due_date')
    .eq('tenant_id', tenantId)
    .in('id', agreementIds);

  for (const row of (dated ?? []) as Array<{ service_agreement_id: string | null; scheduled_date: Ymd | null }>) {
    if (!row.service_agreement_id || !row.scheduled_date) continue;
    const list = result.get(row.service_agreement_id) ?? [];
    list.push(row.scheduled_date);
    result.set(row.service_agreement_id, list);
  }
  for (const row of (agreements ?? []) as Array<{ id: string; next_due_date: Ymd | null }>) {
    if (!row.next_due_date) continue;
    const list = result.get(row.id) ?? [];
    list.push(row.next_due_date);
    result.set(row.id, list);
  }
  for (const list of result.values()) list.sort(compareYmd);
  return result;
}

function nextAfter(dates: Ymd[] | undefined, day: Ymd): Ymd | null {
  if (!dates) return null;
  return dates.find((d) => compareYmd(d, day) > 0) ?? null;
}

export async function previewPushBack(
  db: SupabaseClient,
  p: { tenantId: string; workerId: string; offFrom: Ymd; offTo: Ymd; today?: Ymd },
): Promise<({ success: true } & PushBackPreview) | { success: false; error: string }> {
  const loaded = await loadPlan(db, p);
  if (!loaded.ok) return { success: false, error: loaded.error };
  const { plan, jobs } = loaded;

  const lastDate = plan.moves.reduce<Ymd | null>((latest, m) => (latest && compareYmd(latest, m.to) >= 0 ? latest : m.to), null);
  const first = [...plan.moves].sort((a, b) => compareYmd(a.from, b.from) || a.id.localeCompare(b.id)).slice(0, 5);
  const customerIds = [...new Set(first.map((m) => jobs.get(m.id)?.customer_id).filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (customerIds.length > 0) {
    const { data } = await db.from('customers').select('id, name').eq('tenant_id', p.tenantId).in('id', customerIds);
    for (const row of (data ?? []) as Array<{ id: string; name: string }>) names.set(row.id, row.name);
  }
  return {
    success: true,
    plan,
    lastDate,
    sample: first.map((m) => ({
      customerName: names.get(jobs.get(m.id)?.customer_id ?? '') ?? 'A customer',
      from: m.from,
      to: m.to,
    })),
  };
}

export async function pushBackWithLog(
  db: SupabaseClient,
  p: { tenantId: string; workerId: string; offFrom: Ymd; offTo: Ymd; actor: Actor; notifyCustomers?: boolean; today?: Ymd },
): Promise<{ success: true; moved: number; stuck: number; changeId: string | null } | { success: false; error: string }> {
  const loaded = await loadPlan(db, p);
  if (!loaded.ok) return { success: false, error: loaded.error };
  const { plan } = loaded;
  if (plan.moves.length === 0) return { success: true, moved: 0, stuck: plan.stuck.length, changeId: null };

  let before: JobSnapshot[];
  try {
    before = await snapshotJobs(db, p.tenantId, plan.moves.map((m) => m.id));
  } catch {
    return { success: false, error: 'Could not load the visits. Try again.' };
  }
  const snapshotById = new Map(before.map((s) => [s.job_id, s]));

  // Apply one visit at a time. The id AND the old day AND "still open" AND "still theirs" are all in the condition, so
  // a visit that was finished, moved or given away a moment ago is left alone and simply not counted.
  const moved: Array<{ id: string; from: Ymd; to: Ymd }> = [];
  for (const move of plan.moves) {
    const { data, error } = await db
      .from('jobs')
      .update({ scheduled_date: move.to, route_position: null, updated_at: new Date().toISOString() })
      .eq('id', move.id)
      .eq('tenant_id', p.tenantId)
      .eq('scheduled_date', move.from)
      .eq('assigned_worker_id', p.workerId)
      .in('status', [...RESCHEDULE_STATUSES])
      .select('id');
    if (error) {
      console.error('[push-back] move:', error.message);
      break;
    }
    if (Array.isArray(data) && data.length > 0) moved.push(move);
  }
  if (moved.length === 0) return { success: true, moved: 0, stuck: plan.stuck.length, changeId: null };

  const logged: JobSnapshot[] = [];
  for (const move of moved) {
    const snap = snapshotById.get(move.id);
    if (!snap) continue;
    logged.push({ ...snap, after_date: move.to });
    await writeHistory(db, {
      jobId: move.id,
      fromStatus: snap.status,
      toStatus: snap.status,
      notes: 'Pushed back',
      metadata: { from: move.from, to: move.to },
      actor: p.actor,
    });
  }
  const latest = moved.reduce<Ymd>((max, m) => (compareYmd(m.to, max) > 0 ? m.to : max), moved[0]!.to);
  const changeId = await finishLoggedChange(db, {
    tenantId: p.tenantId,
    kind: 'push_back',
    fromDate: p.offFrom,
    toDate: latest,
    jobIds: moved.map((m) => m.id),
    before: logged,
    notifyCustomers: p.notifyCustomers ?? false,
    actor: p.actor,
  });
  return { success: true, moved: moved.length, stuck: plan.stuck.length, changeId };
}
