import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, isValidYmd, type Ymd } from '@/lib/rounds/dates';
import type { SkipReason } from '@/lib/rounds/skip-reasons';
import {
  RESCHEDULE_STATUSES,
  deleteUntouchedFutureVisits,
  moveRemainingCore,
  rescheduleVisitCore,
  skipVisitCore,
  writeHistory,
  type Actor,
  type SkipVisitResult,
  type TransitionResult,
} from '@/lib/rounds/visit-transitions';

// No 'use server'. Takes a client so dashboard actions and phone APIs share it.

export type VisitChangeKind = 'skip' | 'reschedule' | 'move_remaining' | 'skip_remaining';

export type JobSnapshot = {
  job_id: string;
  status: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  route_position: number | null;
  skip_reason: string | null;
  completion_notes: string | null;
  customer_confirmation_status: string | null;
  customer_requested_date: string | null;
  service_agreement_id: string | null;
  agreement_schedule_mode: 'fixed' | 'after_completion' | null;
  agreement_next_due_date: string | null;
};

export type VisitChangeSummary = {
  id: string;
  kind: VisitChangeKind;
  fromDate: string | null;
  toDate: string | null;
  jobCount: number;
  createdAt: string;
  undoneAt: string | null;
  notifyCustomers: boolean;
  notifiedAt: string | null;
};

export const UNDO_WINDOW_DAYS = 14;

const DAY_MS = 86_400_000;

const KINDS: readonly VisitChangeKind[] = [
  'skip',
  'reschedule',
  'move_remaining',
  'skip_remaining',
];

const SNAPSHOT_COLUMNS = [
  'id',
  'status',
  'scheduled_date',
  'scheduled_time',
  'route_position',
  'skip_reason',
  'completion_notes',
  'customer_confirmation_status',
  'customer_requested_date',
  'service_agreement_id',
  'service_agreements(schedule_mode, next_due_date)',
].join(', ');

const CHANGE_COLUMNS = [
  'id',
  'kind',
  'from_date',
  'to_date',
  'job_ids',
  'before',
  'notify_customers',
  'notified_at',
  'created_at',
  'undone_at',
].join(', ');

type ChangeRow = Record<string, unknown>;

type LoggedChange = {
  tenantId: string;
  kind: VisitChangeKind;
  fromDate: string | null;
  toDate: string | null;
  jobIds: string[];
  before: JobSnapshot[];
  notifyCustomers: boolean;
  actor: Actor;
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function asNullableString(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === 'string' ? value : null;
}

function asYmdOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 10) return null;
  const sliced = value.slice(0, 10);
  return isValidYmd(sliced) ? sliced : null;
}

function asTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function isKind(value: unknown): value is VisitChangeKind {
  return typeof value === 'string' && (KINDS as readonly string[]).includes(value);
}

function isOpenStatus(status: string): boolean {
  return (RESCHEDULE_STATUSES as readonly string[]).includes(status);
}

function agreementEmbed(raw: unknown): {
  mode: 'fixed' | 'after_completion' | null;
  nextDue: string | null;
} {
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!row || typeof row !== 'object') return { mode: null, nextDue: null };
  const record = row as Record<string, unknown>;
  const mode = record.schedule_mode;
  return {
    mode: mode === 'fixed' || mode === 'after_completion' ? mode : null,
    nextDue: asYmdOrNull(record.next_due_date),
  };
}

function snapshotFromRow(row: Record<string, unknown>): JobSnapshot | null {
  const jobId = asString(row.id);
  const status = asString(row.status);
  if (!jobId || !status) return null;
  const agreement = agreementEmbed(row.service_agreements);
  return {
    job_id: jobId,
    status,
    scheduled_date: asYmdOrNull(row.scheduled_date),
    scheduled_time: asTime(row.scheduled_time),
    route_position: asFiniteNumber(row.route_position),
    skip_reason: asNullableString(row.skip_reason),
    completion_notes: asNullableString(row.completion_notes),
    customer_confirmation_status: asNullableString(row.customer_confirmation_status),
    customer_requested_date: asYmdOrNull(row.customer_requested_date),
    service_agreement_id: asNullableString(row.service_agreement_id),
    agreement_schedule_mode: agreement.mode,
    agreement_next_due_date: agreement.nextDue,
  };
}

function parseSnapshot(value: unknown): JobSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const jobId = asString(row.job_id);
  const status = asString(row.status);
  if (!jobId || !status) return null;
  const mode = row.agreement_schedule_mode;
  return {
    job_id: jobId,
    status,
    scheduled_date: asYmdOrNull(row.scheduled_date),
    scheduled_time: asTime(row.scheduled_time),
    route_position: asFiniteNumber(row.route_position),
    skip_reason: asNullableString(row.skip_reason),
    completion_notes: asNullableString(row.completion_notes),
    customer_confirmation_status: asNullableString(row.customer_confirmation_status),
    customer_requested_date: asYmdOrNull(row.customer_requested_date),
    service_agreement_id: asNullableString(row.service_agreement_id),
    agreement_schedule_mode: mode === 'fixed' || mode === 'after_completion' ? mode : null,
    agreement_next_due_date: asYmdOrNull(row.agreement_next_due_date),
  };
}

function parseSnapshots(value: unknown): JobSnapshot[] {
  let raw = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const snapshots: JobSnapshot[] = [];
  for (const item of raw) {
    const snapshot = parseSnapshot(item);
    if (snapshot) snapshots.push(snapshot);
  }
  return snapshots;
}

function jobIdsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === 'string' && id !== '');
}

function snapshotsInOrder(jobIds: string[], before: JobSnapshot[]): JobSnapshot[] {
  const byId = new Map(before.map((snapshot) => [snapshot.job_id, snapshot]));
  const ordered: JobSnapshot[] = [];
  for (const id of jobIds) {
    const snapshot = byId.get(id);
    if (snapshot) ordered.push(snapshot);
  }
  return ordered;
}

function firstScheduledDate(snapshots: JobSnapshot[]): string | null {
  for (const snapshot of snapshots) {
    if (snapshot.scheduled_date) return snapshot.scheduled_date;
  }
  return null;
}

function toSummary(row: ChangeRow): VisitChangeSummary | null {
  const id = asString(row.id);
  if (!id || !isKind(row.kind)) return null;
  const jobIds = jobIdsOf(row.job_ids);
  return {
    id,
    kind: row.kind,
    fromDate: asYmdOrNull(row.from_date),
    toDate: asYmdOrNull(row.to_date),
    jobCount: jobIds.length,
    createdAt: asString(row.created_at) ?? '',
    undoneAt: asString(row.undone_at),
    notifyCustomers: row.notify_customers === true,
    notifiedAt: asString(row.notified_at),
  };
}

function isTooOld(createdAt: string, now: Date): boolean {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return true;
  return now.getTime() - created.getTime() > UNDO_WINDOW_DAYS * DAY_MS;
}

function stillAsLeft(kind: VisitChangeKind, job: { status: string; scheduled_date: string | null }, toDate: string | null): boolean {
  if (kind === 'skip' || kind === 'skip_remaining') return job.status === 'cancelled';
  if (!toDate) return false;
  return job.scheduled_date === toDate && isOpenStatus(job.status);
}

/** Throws if the jobs read fails. Callers that must not proceed without a snapshot should catch it. */
export async function snapshotJobs(
  supabase: SupabaseClient,
  tenantId: string,
  jobIds: string[],
): Promise<JobSnapshot[]> {
  if (jobIds.length === 0) return [];
  const { data, error } = await supabase
    .from('jobs')
    .select(SNAPSHOT_COLUMNS)
    .eq('tenant_id', tenantId)
    .in('id', jobIds);
  if (error) {
    console.error('[snapshotJobs]', error);
    throw new Error('Failed to load visits.');
  }
  const byId = new Map<string, JobSnapshot>();
  for (const raw of data ?? []) {
    if (!raw || typeof raw !== 'object') continue;
    const snapshot = snapshotFromRow(raw as Record<string, unknown>);
    if (snapshot) byId.set(snapshot.job_id, snapshot);
  }
  return snapshotsInOrder(jobIds, [...byId.values()]);
}

/** Insert one visit_changes row (caller's client, RLS admin insert). Returns the id, or null if the insert failed (logged). */
export async function recordVisitChange(
  supabase: SupabaseClient,
  p: {
    tenantId: string;
    kind: VisitChangeKind;
    fromDate: string | null;
    toDate: string | null;
    jobIds: string[];
    before: JobSnapshot[];
    notifyCustomers: boolean;
    actor: Actor;
  },
): Promise<string | null> {
  if (p.jobIds.length === 0 || p.before.length === 0) {
    console.error('[visit-changes] recordVisitChange: nothing to record');
    return null;
  }
  const { data, error } = await supabase
    .from('visit_changes')
    .insert({
      tenant_id: p.tenantId,
      kind: p.kind,
      from_date: p.fromDate,
      to_date: p.toDate,
      job_ids: p.jobIds,
      before: p.before,
      notify_customers: p.notifyCustomers,
      created_by_user_id: p.actor.userId ?? null,
    })
    .select('id')
    .maybeSingle();
  const id = data && typeof data === 'object' ? asString((data as { id?: unknown }).id) : null;
  if (error || !id) {
    console.error('[visit-changes] recordVisitChange', error);
    return null;
  }
  return id;
}

async function loadSnapshots(
  supabase: SupabaseClient,
  tenantId: string,
  jobIds: string[],
): Promise<JobSnapshot[] | null> {
  try {
    return await snapshotJobs(supabase, tenantId, jobIds);
  } catch (err) {
    console.error('[visit-changes] snapshotJobs', err);
    return null;
  }
}

async function listOpenJobIds(
  supabase: SupabaseClient,
  tenantId: string,
  date: string,
): Promise<string[] | null> {
  const { data, error } = await supabase
    .from('jobs')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('scheduled_date', date)
    .in('status', [...RESCHEDULE_STATUSES]);
  if (error) {
    console.error('[visit-changes] list jobs:', error);
    return null;
  }
  const ids: string[] = [];
  for (const raw of data ?? []) {
    const id = raw && typeof raw === 'object' ? asString((raw as { id?: unknown }).id) : null;
    if (id) ids.push(id);
  }
  return ids;
}

async function clearReplyLabels(
  supabase: SupabaseClient,
  tenantId: string,
  jobIds: string[],
): Promise<void> {
  if (jobIds.length === 0) return;
  const { error } = await supabase
    .from('jobs')
    .update({
      customer_confirmation_status: null,
      customer_requested_date: null,
      customer_reply_at: null,
    })
    .eq('tenant_id', tenantId)
    .in('id', jobIds);
  if (error) console.error('[visit-changes] clear reply labels:', error);
}

async function finishLoggedChange(
  supabase: SupabaseClient,
  p: LoggedChange,
): Promise<string | null> {
  const ordered = snapshotsInOrder(p.jobIds, p.before);
  let changeId: string | null = null;
  if (ordered.length > 0) {
    changeId = await recordVisitChange(supabase, {
      tenantId: p.tenantId,
      kind: p.kind,
      fromDate: p.fromDate,
      toDate: p.toDate,
      jobIds: ordered.map((snapshot) => snapshot.job_id),
      before: ordered,
      notifyCustomers: p.notifyCustomers,
      actor: p.actor,
    });
  } else if (p.jobIds.length > 0) {
    console.error('[visit-changes] changed visits had no snapshot');
  }
  await clearReplyLabels(supabase, p.tenantId, p.jobIds);
  return changeId;
}

type SkipListResult =
  | { success: true; skipped: number; changeId: string | null }
  | { success: false; error: string; code?: 'already_completed'; retryable?: boolean };

async function skipListed(
  supabase: SupabaseClient,
  p: {
    tenantId: string;
    jobIds: string[];
    reason: SkipReason;
    note: string | null;
    actor: Actor;
    notifyCustomers: boolean;
    kind: 'skip' | 'skip_remaining';
    fromDate: string | null;
  },
): Promise<SkipListResult> {
  const before = await loadSnapshots(supabase, p.tenantId, p.jobIds);
  if (!before) return { success: false, error: 'Could not load the visits. Try again.' };

  const changedIds: string[] = [];
  for (const jobId of p.jobIds) {
    const result = await skipVisitCore(supabase, {
      tenantId: p.tenantId,
      jobId,
      reason: p.reason,
      note: p.note,
      actor: p.actor,
    });
    if (!result.success) {
      // Stops already skipped stay skipped. Log them so Undo can put them back.
      if (changedIds.length > 0) {
        const ordered = snapshotsInOrder(changedIds, before);
        await finishLoggedChange(supabase, {
          tenantId: p.tenantId,
          kind: p.kind,
          fromDate: p.kind === 'skip_remaining' ? p.fromDate : firstScheduledDate(ordered),
          toDate: null,
          jobIds: changedIds,
          before,
          notifyCustomers: p.notifyCustomers,
          actor: p.actor,
        });
      }
      return result;
    }
    if (!result.alreadySkipped) changedIds.push(jobId);
  }

  if (changedIds.length === 0) {
    return { success: true, skipped: 0, changeId: null };
  }
  const ordered = snapshotsInOrder(changedIds, before);
  const changeId = await finishLoggedChange(supabase, {
    tenantId: p.tenantId,
    kind: p.kind,
    fromDate: p.kind === 'skip_remaining' ? p.fromDate : firstScheduledDate(ordered),
    toDate: null,
    jobIds: changedIds,
    before,
    notifyCustomers: p.notifyCustomers,
    actor: p.actor,
  });
  return { success: true, skipped: changedIds.length, changeId };
}

/** Skip every job of one stop (e.g. two services at one house) as ONE change. Used by step 20's reply actions. */
export async function skipStopWithLog(
  supabase: SupabaseClient,
  p: {
    tenantId: string;
    jobIds: string[];
    reason: SkipReason;
    actor: Actor;
    notifyCustomers?: boolean;
  },
): Promise<{ success: true; skipped: number; changeId: string | null } | { success: false; error: string }> {
  const result = await skipListed(supabase, {
    tenantId: p.tenantId,
    jobIds: p.jobIds,
    reason: p.reason,
    note: null,
    actor: p.actor,
    notifyCustomers: p.notifyCustomers ?? false,
    kind: 'skip',
    fromDate: null,
  });
  if (!result.success) return { success: false, error: result.error };
  return { success: true, skipped: result.skipped, changeId: result.changeId };
}

async function rescheduleListed(
  supabase: SupabaseClient,
  p: {
    tenantId: string;
    jobIds: string[];
    scheduledDate: Ymd;
    scheduledTime?: string | null;
    actor: Actor;
    notifyCustomers: boolean;
  },
): Promise<{ success: true; moved: number; changeId: string | null } | { success: false; error: string }> {
  const before = await loadSnapshots(supabase, p.tenantId, p.jobIds);
  if (!before) return { success: false, error: 'Could not load the visits. Try again.' };

  const movedIds: string[] = [];
  for (const jobId of p.jobIds) {
    const result = await rescheduleVisitCore(supabase, {
      tenantId: p.tenantId,
      jobId,
      scheduledDate: p.scheduledDate,
      scheduledTime: p.scheduledTime,
      actor: p.actor,
    });
    if (!result.success) {
      if (movedIds.length > 0) {
        const ordered = snapshotsInOrder(movedIds, before);
        await finishLoggedChange(supabase, {
          tenantId: p.tenantId,
          kind: 'reschedule',
          fromDate: firstScheduledDate(ordered),
          toDate: p.scheduledDate,
          jobIds: movedIds,
          before,
          notifyCustomers: p.notifyCustomers,
          actor: p.actor,
        });
      }
      return result;
    }
    movedIds.push(jobId);
  }

  if (movedIds.length === 0) {
    return { success: true, moved: 0, changeId: null };
  }
  const ordered = snapshotsInOrder(movedIds, before);
  const changeId = await finishLoggedChange(supabase, {
    tenantId: p.tenantId,
    kind: 'reschedule',
    fromDate: firstScheduledDate(ordered),
    toDate: p.scheduledDate,
    jobIds: movedIds,
    before,
    notifyCustomers: p.notifyCustomers,
    actor: p.actor,
  });
  return { success: true, moved: movedIds.length, changeId };
}

/** Move every job of one stop to a date as ONE change (kind 'reschedule'). */
export async function rescheduleStopWithLog(
  supabase: SupabaseClient,
  p: {
    tenantId: string;
    jobIds: string[];
    scheduledDate: Ymd;
    actor: Actor;
    notifyCustomers?: boolean;
  },
): Promise<{ success: true; moved: number; changeId: string | null } | { success: false; error: string }> {
  return rescheduleListed(supabase, {
    tenantId: p.tenantId,
    jobIds: p.jobIds,
    scheduledDate: p.scheduledDate,
    actor: p.actor,
    notifyCustomers: p.notifyCustomers ?? false,
  });
}

export async function skipVisitWithLog(
  supabase: SupabaseClient,
  p: {
    tenantId: string;
    jobId: string;
    reason: SkipReason;
    note?: string | null;
    actor: Actor;
    notifyCustomer?: boolean;
  },
): Promise<SkipVisitResult & { changeId?: string | null }> {
  const result = await skipListed(supabase, {
    tenantId: p.tenantId,
    jobIds: [p.jobId],
    reason: p.reason,
    note: p.note ?? null,
    actor: p.actor,
    notifyCustomers: p.notifyCustomer ?? false,
    kind: 'skip',
    fromDate: null,
  });
  if (!result.success) return result;
  return {
    success: true,
    alreadySkipped: result.skipped === 0,
    changeId: result.changeId,
  };
}

export async function rescheduleVisitWithLog(
  supabase: SupabaseClient,
  p: {
    tenantId: string;
    jobId: string;
    scheduledDate: Ymd;
    scheduledTime?: string | null;
    actor: Actor;
    notifyCustomer?: boolean;
  },
): Promise<TransitionResult & { changeId?: string | null }> {
  const result = await rescheduleListed(supabase, {
    tenantId: p.tenantId,
    jobIds: [p.jobId],
    scheduledDate: p.scheduledDate,
    scheduledTime: p.scheduledTime,
    actor: p.actor,
    notifyCustomers: p.notifyCustomer ?? false,
  });
  if (!result.success) return result;
  return { success: true, changeId: result.changeId };
}

export async function moveRemainingWithLog(
  supabase: SupabaseClient,
  p: {
    tenantId: string;
    fromDate: Ymd;
    toDate: Ymd;
    scheduledTime?: string | null;
    actor: Actor;
    notifyCustomers?: boolean;
  },
): Promise<{ success: true; moved: number; changeId: string | null } | { success: false; error: string }> {
  const jobIds = await listOpenJobIds(supabase, p.tenantId, p.fromDate);
  if (!jobIds) return { success: false, error: 'Failed to load leftover stops.' };
  const before = await loadSnapshots(supabase, p.tenantId, jobIds);
  if (!before) return { success: false, error: 'Could not load the visits. Try again.' };

  const result = await moveRemainingCore(supabase, {
    tenantId: p.tenantId,
    fromDate: p.fromDate,
    toDate: p.toDate,
    scheduledTime: p.scheduledTime,
    actor: p.actor,
  });
  if (!result.success) {
    const movedIds = await listedJobsOnDate(supabase, p.tenantId, jobIds, p.toDate);
    if (movedIds && movedIds.length > 0) {
      await finishLoggedChange(supabase, {
        tenantId: p.tenantId,
        kind: 'move_remaining',
        fromDate: p.fromDate,
        toDate: p.toDate,
        jobIds: movedIds,
        before,
        notifyCustomers: p.notifyCustomers ?? false,
        actor: p.actor,
      });
    }
    return result;
  }
  if (result.moved === 0) return { success: true, moved: 0, changeId: null };

  const changeId = await finishLoggedChange(supabase, {
    tenantId: p.tenantId,
    kind: 'move_remaining',
    fromDate: p.fromDate,
    toDate: p.toDate,
    jobIds,
    before,
    notifyCustomers: p.notifyCustomers ?? false,
    actor: p.actor,
  });
  return { success: true, moved: result.moved, changeId };
}

export async function skipRemainingCore(
  supabase: SupabaseClient,
  p: {
    tenantId: string;
    date: Ymd;
    actor: Actor;
    notifyCustomers?: boolean;
  },
): Promise<{ success: true; skipped: number; changeId: string | null } | { success: false; error: string }> {
  if (!isValidYmd(p.date)) return { success: false, error: 'Pick a valid date.' };
  const jobIds = await listOpenJobIds(supabase, p.tenantId, p.date);
  if (!jobIds) return { success: false, error: 'Failed to load leftover stops.' };
  const result = await skipListed(supabase, {
    tenantId: p.tenantId,
    jobIds,
    reason: 'trader_unavailable',
    note: null,
    actor: p.actor,
    notifyCustomers: p.notifyCustomers ?? false,
    kind: 'skip_remaining',
    fromDate: p.date,
  });
  if (!result.success) return { success: false, error: result.error };
  return { success: true, skipped: result.skipped, changeId: result.changeId };
}

async function loadChangeRow(
  supabase: SupabaseClient,
  tenantId: string,
  changeId: string,
): Promise<{ ok: true; row: ChangeRow | null } | { ok: false }> {
  const { data, error } = await supabase
    .from('visit_changes')
    .select(CHANGE_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('id', changeId)
    .maybeSingle();
  if (error) {
    console.error('[visit-changes] load change:', error);
    return { ok: false };
  }
  if (!data || typeof data !== 'object') return { ok: true, row: null };
  return { ok: true, row: data as ChangeRow };
}

type RestoreOutcome = 'restored' | 'leftAlone' | 'error';

type UndoJob = {
  status: string;
  scheduled_date: string | null;
};

async function loadJobForUndo(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
): Promise<{ ok: true; job: UndoJob | null } | { ok: false }> {
  const { data, error } = await supabase
    .from('jobs')
    .select('id, status, scheduled_date')
    .eq('id', jobId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) {
    console.error('[undoVisitChangeCore] load job:', error);
    return { ok: false };
  }
  if (!data || typeof data !== 'object') return { ok: true, job: null };
  const row = data as Record<string, unknown>;
  const status = asString(row.status);
  if (!status) return { ok: true, job: null };
  return {
    ok: true,
    job: { status, scheduled_date: asYmdOrNull(row.scheduled_date) },
  };
}

async function claimUndo(
  supabase: SupabaseClient,
  tenantId: string,
  changeId: string,
  undoneAt: string,
  userId: string | null,
): Promise<'claimed' | 'taken' | 'error'> {
  const { data, error } = await supabase
    .from('visit_changes')
    .update({
      undone_at: undoneAt,
      undone_by_user_id: userId,
    })
    .eq('id', changeId)
    .eq('tenant_id', tenantId)
    .is('undone_at', null)
    .select('id');
  if (error) {
    console.error('[undoVisitChangeCore] claim:', error);
    return 'error';
  }
  if (!Array.isArray(data) || data.length === 0) return 'taken';
  return 'claimed';
}

async function releaseUndoClaim(
  supabase: SupabaseClient,
  tenantId: string,
  changeId: string,
  undoneAt: string,
): Promise<void> {
  const { error } = await supabase
    .from('visit_changes')
    .update({ undone_at: null, undone_by_user_id: null })
    .eq('id', changeId)
    .eq('tenant_id', tenantId)
    .eq('undone_at', undoneAt);
  if (error) console.error('[undoVisitChangeCore] release claim:', error);
}

async function listedJobsOnDate(
  supabase: SupabaseClient,
  tenantId: string,
  jobIds: string[],
  date: string,
): Promise<string[] | null> {
  if (jobIds.length === 0) return [];
  const { data, error } = await supabase
    .from('jobs')
    .select('id, scheduled_date')
    .eq('tenant_id', tenantId)
    .in('id', jobIds);
  if (error) {
    console.error('[visit-changes] jobs on date:', error);
    return null;
  }
  const onDate = new Set<string>();
  for (const raw of data ?? []) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const id = asString(row.id);
    if (id && asYmdOrNull(row.scheduled_date) === date) onDate.add(id);
  }
  return jobIds.filter((id) => onDate.has(id));
}

async function restoreSkippedJob(
  supabase: SupabaseClient,
  tenantId: string,
  snapshot: JobSnapshot,
  actor: Actor,
): Promise<RestoreOutcome> {
  // Agreement first, while the visit is still cancelled, so a failed cursor
  // write leaves the skip in place and a second Undo can finish it.
  if (snapshot.agreement_schedule_mode === 'after_completion' && snapshot.service_agreement_id) {
    if (snapshot.scheduled_date && isValidYmd(snapshot.scheduled_date)) {
      try {
        await deleteUntouchedFutureVisits(supabase, {
          tenantId,
          agreementId: snapshot.service_agreement_id,
          fromDate: addDays(snapshot.scheduled_date, 1),
        });
      } catch (err) {
        console.error('[undoVisitChangeCore] delete generated:', err);
        return 'error';
      }
    }
    const { error: cursorError } = await supabase
      .from('service_agreements')
      .update({ next_due_date: snapshot.agreement_next_due_date })
      .eq('id', snapshot.service_agreement_id)
      .eq('tenant_id', tenantId);
    if (cursorError) {
      console.error('[undoVisitChangeCore] next_due_date:', cursorError);
      return 'error';
    }
  }

  const { data, error } = await supabase
    .from('jobs')
    .update({
      status: snapshot.status,
      skip_reason: snapshot.skip_reason,
      completion_notes: snapshot.completion_notes,
      customer_confirmation_status: snapshot.customer_confirmation_status,
      customer_requested_date: snapshot.customer_requested_date,
      route_position: null,
    })
    .eq('id', snapshot.job_id)
    .eq('tenant_id', tenantId)
    .eq('status', 'cancelled')
    .select('id');
  if (error) {
    console.error('[undoVisitChangeCore] restore skip:', error);
    return 'error';
  }
  if (!Array.isArray(data) || data.length === 0) return 'leftAlone';

  await writeHistory(supabase, {
    jobId: snapshot.job_id,
    fromStatus: 'cancelled',
    toStatus: snapshot.status,
    notes: 'Skip undone',
    metadata: {},
    actor,
  });
  return 'restored';
}

async function restoreMovedJob(
  supabase: SupabaseClient,
  tenantId: string,
  snapshot: JobSnapshot,
  toDate: string,
  status: string,
  actor: Actor,
): Promise<RestoreOutcome> {
  const { data, error } = await supabase
    .from('jobs')
    .update({
      scheduled_date: snapshot.scheduled_date,
      scheduled_time: snapshot.scheduled_time,
      route_position: null,
      customer_confirmation_status: snapshot.customer_confirmation_status,
      customer_requested_date: snapshot.customer_requested_date,
    })
    .eq('id', snapshot.job_id)
    .eq('tenant_id', tenantId)
    .eq('scheduled_date', toDate)
    .in('status', [...RESCHEDULE_STATUSES])
    .select('id');
  if (error) {
    console.error('[undoVisitChangeCore] restore move:', error);
    return 'error';
  }
  if (!Array.isArray(data) || data.length === 0) return 'leftAlone';

  await writeHistory(supabase, {
    jobId: snapshot.job_id,
    fromStatus: status,
    toStatus: status,
    notes: 'Move undone',
    metadata: { from: toDate, to: snapshot.scheduled_date },
    actor,
  });
  return 'restored';
}

export async function undoVisitChangeCore(
  supabase: SupabaseClient,
  p: {
    tenantId: string;
    changeId: string;
    actor: Actor;
    now?: Date;
  },
): Promise<
  | { success: true; restored: number; leftAlone: number; restoredJobIds: string[]; change: VisitChangeSummary }
  | { success: false; error: string }
> {
  const loaded = await loadChangeRow(supabase, p.tenantId, p.changeId);
  if (!loaded.ok) return { success: false, error: 'Could not load the change. Try again.' };
  if (!loaded.row) return { success: false, error: 'Change not found' };
  const summary = toSummary(loaded.row);
  if (!summary) return { success: false, error: 'Change not found' };
  if (summary.undoneAt) return { success: false, error: 'Already undone' };

  const now = p.now ?? new Date();
  if (isTooOld(summary.createdAt, now)) return { success: false, error: 'Too old to undo' };

  // Claim before restoring so a second tap cannot run the restore twice.
  // A failed restore releases the claim so the change can be tried again.
  const undoneAt = now.toISOString();
  const claim = await claimUndo(
    supabase,
    p.tenantId,
    p.changeId,
    undoneAt,
    p.actor.userId ?? null,
  );
  if (claim === 'error') return { success: false, error: 'Could not undo this change. Try again.' };
  if (claim === 'taken') return { success: false, error: 'Already undone' };

  const snapshots = parseSnapshots(loaded.row.before);
  let restored = 0;
  let leftAlone = 0;
  const restoredJobIds: string[] = [];
  const fail = async () => {
    await releaseUndoClaim(supabase, p.tenantId, p.changeId, undoneAt);
    return { success: false as const, error: 'Could not undo this change. Try again.' };
  };

  for (const snapshot of snapshots) {
    const loadedJob = await loadJobForUndo(supabase, p.tenantId, snapshot.job_id);
    if (!loadedJob.ok) return fail();
    if (!loadedJob.job || !stillAsLeft(summary.kind, loadedJob.job, summary.toDate)) {
      leftAlone += 1;
      continue;
    }
    const isSkip = summary.kind === 'skip' || summary.kind === 'skip_remaining';
    if (!isSkip && !summary.toDate) {
      leftAlone += 1;
      continue;
    }
    const outcome = isSkip
      ? await restoreSkippedJob(supabase, p.tenantId, snapshot, p.actor)
      : await restoreMovedJob(
          supabase,
          p.tenantId,
          snapshot,
          summary.toDate as string,
          loadedJob.job.status,
          p.actor,
        );
    if (outcome === 'error') return fail();
    if (outcome === 'leftAlone') {
      leftAlone += 1;
      continue;
    }
    restored += 1;
    restoredJobIds.push(snapshot.job_id);
  }

  return {
    success: true,
    restored,
    leftAlone,
    restoredJobIds,
    change: { ...summary, undoneAt },
  };
}

/** The newest change that is not undone, within the window, optionally touching `date` (from or to). */
export async function latestUndoableChange(
  supabase: SupabaseClient,
  tenantId: string,
  opts?: { date?: Ymd; now?: Date },
): Promise<VisitChangeSummary | null> {
  if (opts?.date != null && !isValidYmd(opts.date)) return null;
  const now = opts?.now ?? new Date();
  const cutoff = new Date(now.getTime() - UNDO_WINDOW_DAYS * DAY_MS).toISOString();
  let query = supabase
    .from('visit_changes')
    .select(CHANGE_COLUMNS)
    .eq('tenant_id', tenantId)
    .is('undone_at', null)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(1);
  if (opts?.date) {
    query = query.or(`from_date.eq.${opts.date},to_date.eq.${opts.date}`);
  }
  const { data, error } = await query.maybeSingle();
  if (error) {
    console.error('[visit-changes] latestUndoableChange:', error);
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  return toSummary(data as ChangeRow);
}

export async function getVisitChange(
  supabase: SupabaseClient,
  tenantId: string,
  changeId: string,
): Promise<(VisitChangeSummary & { jobIds: string[]; before: JobSnapshot[] }) | null> {
  const loaded = await loadChangeRow(supabase, tenantId, changeId);
  if (!loaded.ok || !loaded.row) return null;
  const summary = toSummary(loaded.row);
  if (!summary) return null;
  return {
    ...summary,
    jobIds: jobIdsOf(loaded.row.job_ids),
    before: parseSnapshots(loaded.row.before),
  };
}
