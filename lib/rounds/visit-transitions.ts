import type { SupabaseClient } from '@supabase/supabase-js';
import { getRoundsSettings } from '@/lib/data/rounds/settings';
import { isValidYmd, todayInLondon, type Ymd } from '@/lib/rounds/dates';
import {
  generateVisitsForAgreement,
  mapAgreementRow,
  type AgreementRow,
} from '@/lib/rounds/generate-visits';
import { nextDueAfter, planNextAfterCompletion } from '@/lib/rounds/recurrence';
import { getSoloWorkerForTenant } from '@/lib/rounds/rounds-worker';
import type { SkipReason } from '@/lib/rounds/skip-reasons';
import { afterVisitCompleted } from '@/lib/payments/after-complete';
import { recordPaymentCore } from '@/lib/payments/money-core';

export type TransitionResult = { success: true } | { success: false; error: string };

export type CompleteVisitPayment = { method: 'cash' | 'cheque'; amount: number };

/** `retryable`: a database/server failure worth retrying (APIs answer 503), not a bad request. */
export type CompleteVisitResult =
  | {
      success: true;
      alreadyCompleted: boolean;
      skippedElsewhere: boolean;
      paymentId: string | null;
      paymentDuplicate: boolean;
    }
  | { success: false; error: string; retryable?: boolean };

export type SkipVisitResult =
  | { success: true; alreadySkipped: boolean }
  | { success: false; error: string; code?: 'already_completed'; retryable?: boolean };

/** PostgREST filter for "still open": Done and Skip only ever move a visit out of these. */
const CLOSED_STATUSES = '(completed,cancelled)';

export const UNTOUCHED_STATUSES = ['assigned'] as const;

import { RESCHEDULE_STATUSES } from '@/lib/rounds/visit-statuses';

export { RESCHEDULE_STATUSES };

export type Actor = { userId?: string; workerId?: string };

function asYmd(value: unknown): Ymd | null {
  if (typeof value !== 'string' || value.length < 10) return null;
  const sliced = value.slice(0, 10);
  return isValidYmd(sliced) ? sliced : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normaliseTime(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function isRescheduleStatus(status: string): boolean {
  return (RESCHEDULE_STATUSES as readonly string[]).includes(status);
}

type JobRow = {
  id: string;
  status: string;
  scheduled_date: Ymd | null;
  scheduled_time: string | null;
  service_agreement_id: string | null;
  route_position: number | null;
  customer_id: string | null;
};

/** Like `loadJob`, but tells a database error (`ok: false`) apart from "no such visit". */
async function loadJobChecked(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
): Promise<{ ok: true; job: JobRow | null } | { ok: false }> {
  const { data, error } = await supabase
    .from('jobs')
    .select(
      'id, status, scheduled_date, scheduled_time, service_agreement_id, route_position, customer_id',
    )
    .eq('id', jobId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) {
    console.error('[visit-transitions] loadJob error:', error);
    return { ok: false };
  }
  if (!data) return { ok: true, job: null };
  const id = typeof data.id === 'string' ? data.id : null;
  const status = typeof data.status === 'string' ? data.status : null;
  if (!id || !status) return { ok: true, job: null };
  return {
    ok: true,
    job: {
      id,
      status,
      scheduled_date: asYmd(data.scheduled_date),
      scheduled_time: typeof data.scheduled_time === 'string' ? data.scheduled_time : null,
      service_agreement_id:
        typeof data.service_agreement_id === 'string' ? data.service_agreement_id : null,
      route_position: asFiniteNumber(data.route_position),
      customer_id: typeof data.customer_id === 'string' ? data.customer_id : null,
    },
  };
}

export async function loadJob(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
): Promise<JobRow | null> {
  const loaded = await loadJobChecked(supabase, tenantId, jobId);
  return loaded.ok ? loaded.job : null;
}

async function loadAgreement(
  supabase: SupabaseClient,
  tenantId: string,
  agreementId: string,
): Promise<AgreementRow | null> {
  const { data, error } = await supabase
    .from('service_agreements')
    .select('*')
    .eq('id', agreementId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error || !data) return null;
  return mapAgreementRow(data as unknown as Record<string, unknown>);
}

export async function writeHistory(
  supabase: SupabaseClient,
  row: {
    jobId: string;
    fromStatus: string | null;
    toStatus: string;
    notes: string | null;
    metadata: Record<string, unknown>;
    actor: Actor;
  },
): Promise<void> {
  const { error } = await supabase.from('job_status_history').insert({
    job_id: row.jobId,
    from_status: row.fromStatus,
    to_status: row.toStatus,
    created_at: new Date().toISOString(),
    changed_by_user_id: row.actor.userId ?? null,
    changed_by_worker_id: row.actor.workerId ?? null,
    notes: row.notes,
    metadata: row.metadata,
  });
  if (error) {
    console.error('[visit-transitions] job_status_history insert error:', error);
  }
}

async function generateAfterCompletion(
  supabase: SupabaseClient,
  tenantId: string,
  agreement: AgreementRow,
  today: Ymd,
): Promise<void> {
  const [settings, solo] = await Promise.all([
    getRoundsSettings(supabase, tenantId),
    getSoloWorkerForTenant(supabase, tenantId),
  ]);
  try {
    await generateVisitsForAgreement(supabase, {
      tenantId,
      agreement,
      settings,
      workerId: agreement.assigned_worker_id ?? solo?.id ?? null,
      today,
    });
  } catch (err) {
    console.error('[visit-transitions] generateVisitsForAgreement:', agreement.id, err);
  }
}

const FIVE_MIN_MS = 5 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function clampCompletedAt(raw: string | null | undefined, now: Date = new Date()): Date {
  if (!raw) return now;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return now;
  const t = parsed.getTime();
  if (t > now.getTime() + FIVE_MIN_MS) return now;
  if (t < now.getTime() - SEVEN_DAYS_MS) return now;
  return parsed;
}

async function recordOptionalPayment(
  supabase: SupabaseClient,
  params: {
    tenantId: string;
    customerId: string | null;
    jobId: string;
    payment: CompleteVisitPayment | null | undefined;
    clientMutationId?: string | null;
    userId: string | null;
  },
): Promise<
  | { ok: true; paymentId: string | null; paymentDuplicate: boolean }
  | { ok: false; error: string; retryable: boolean }
> {
  if (!params.payment) {
    return { ok: true, paymentId: null, paymentDuplicate: false };
  }
  if (!params.customerId) {
    return { ok: false, error: 'Could not record the payment.', retryable: false };
  }
  const result = await recordPaymentCore(supabase, {
    tenantId: params.tenantId,
    customerId: params.customerId,
    amount: params.payment.amount,
    method: params.payment.method,
    appliesToJobId: params.jobId,
    clientMutationId: params.clientMutationId ?? null,
    userId: params.userId,
  });
  if (!result.success) {
    return { ok: false, error: result.error, retryable: result.retryable === true };
  }
  return {
    ok: true,
    paymentId: result.paymentId,
    paymentDuplicate: result.duplicate,
  };
}

type CompleteVisitParams = {
  tenantId: string;
  jobId: string;
  finalAmount?: number | null;
  notes?: string | null;
  actor: Actor;
  payment?: CompleteVisitPayment | null;
  /** true/false = set the customer's "send invoice after each visit"; null/undefined = leave it. */
  sendInvoice?: boolean | null;
  clientMutationId?: string | null;
  /** When the tap happened (phone, possibly offline). Clamped; default now. */
  completedAt?: string | null;
  /**
   * What to do with `payment` when the visit was already done or skipped by
   * someone else. `'record'` (default — the phone: the cash was really taken
   * and a replay must never drop it). `'ignore'` (the dashboard: a stale page
   * would otherwise record the phone's cash a second time; the trader is there
   * to use Mark as paid instead).
   */
  alreadyDonePayment?: 'record' | 'ignore';
};

/** Done arrived for a visit that is already skipped: keep any cash as credit against this job id. */
async function completeWhenSkipped(
  supabase: SupabaseClient,
  params: CompleteVisitParams,
  job: JobRow,
): Promise<CompleteVisitResult> {
  const payment = await recordOptionalPayment(supabase, {
    tenantId: params.tenantId,
    customerId: job.customer_id,
    jobId: job.id,
    payment: params.alreadyDonePayment === 'ignore' ? null : params.payment,
    clientMutationId: params.clientMutationId,
    userId: params.actor.userId ?? null,
  });
  if (!payment.ok) {
    return { success: false, error: payment.error, retryable: payment.retryable };
  }
  return {
    success: true,
    alreadyCompleted: false,
    skippedElsewhere: true,
    paymentId: payment.paymentId,
    paymentDuplicate: payment.paymentDuplicate,
  };
}

/** Done twice / replay: payment (idempotent via clientMutationId) + sendInvoice + after hooks only. */
async function completeWhenAlreadyDone(
  supabase: SupabaseClient,
  params: CompleteVisitParams,
  job: JobRow,
): Promise<CompleteVisitResult> {
  const payment = await recordOptionalPayment(supabase, {
    tenantId: params.tenantId,
    customerId: job.customer_id,
    jobId: job.id,
    payment: params.alreadyDonePayment === 'ignore' ? null : params.payment,
    clientMutationId: params.clientMutationId,
    userId: params.actor.userId ?? null,
  });
  if (!payment.ok) {
    return { success: false, error: payment.error, retryable: payment.retryable };
  }
  await afterVisitCompleted(supabase, {
    tenantId: params.tenantId,
    jobId: job.id,
    customerId: job.customer_id,
    sendInvoice: params.sendInvoice,
  });
  return {
    success: true,
    alreadyCompleted: true,
    skippedElsewhere: false,
    paymentId: payment.paymentId,
    paymentDuplicate: payment.paymentDuplicate,
  };
}

export async function completeVisitCore(
  supabase: SupabaseClient,
  params: CompleteVisitParams,
): Promise<CompleteVisitResult> {
  const loaded = await loadJobChecked(supabase, params.tenantId, params.jobId);
  if (!loaded.ok) {
    return { success: false, error: 'Could not load the visit. Try again.', retryable: true };
  }
  const job = loaded.job;
  if (!job) return { success: false, error: 'Visit not found.' };

  const completedAt = clampCompletedAt(params.completedAt);
  const userId = params.actor.userId ?? null;

  if (job.status === 'cancelled') return completeWhenSkipped(supabase, params, job);
  if (job.status === 'completed') return completeWhenAlreadyDone(supabase, params, job);

  const updates: Record<string, unknown> = {
    status: 'completed',
    completed_at: completedAt.toISOString(),
  };
  if (params.finalAmount !== undefined && params.finalAmount !== null) {
    updates.final_amount = params.finalAmount;
  }
  if (params.notes != null && params.notes.trim() !== '') {
    updates.completion_notes = params.notes.trim();
  }

  // Conditional on the visit still being open, so a Skip or another Done that
  // landed since loadJob can't be overwritten (and can't be completed twice).
  const { data: updated, error } = await supabase
    .from('jobs')
    .update(updates)
    .eq('id', job.id)
    .eq('tenant_id', params.tenantId)
    .not('status', 'in', CLOSED_STATUSES)
    .select('id');
  if (error) {
    console.error('[completeVisitCore] update error:', error);
    return { success: false, error: 'Failed to complete visit. Try again.', retryable: true };
  }
  if (!Array.isArray(updated) || updated.length === 0) {
    const again = await loadJobChecked(supabase, params.tenantId, job.id);
    if (!again.ok) {
      return { success: false, error: 'Could not load the visit. Try again.', retryable: true };
    }
    if (again.job?.status === 'completed') {
      return completeWhenAlreadyDone(supabase, params, again.job);
    }
    if (again.job?.status === 'cancelled') {
      return completeWhenSkipped(supabase, params, again.job);
    }
    return { success: false, error: 'Could not mark this visit done.' };
  }

  await writeHistory(supabase, {
    jobId: job.id,
    fromStatus: job.status,
    toStatus: 'completed',
    notes: params.notes?.trim() || null,
    metadata: {},
    actor: params.actor,
  });

  if (job.service_agreement_id) {
    const agreement = await loadAgreement(
      supabase,
      params.tenantId,
      job.service_agreement_id,
    );
    if (agreement?.schedule_mode === 'after_completion' && agreement.status === 'active') {
      const completedOn = todayInLondon(completedAt);
      const settings = await getRoundsSettings(supabase, params.tenantId);
      const planned = planNextAfterCompletion({
        completedOn,
        frequencyDays: agreement.frequency_days,
        preferredWeekday: agreement.preferred_weekday,
        settings,
        today: completedOn,
      });
      const { error: cursorError } = await supabase
        .from('service_agreements')
        .update({ next_due_date: planned.occurrenceDate })
        .eq('id', agreement.id)
        .eq('tenant_id', params.tenantId);
      if (cursorError) {
        console.error('[completeVisitCore] next_due_date update:', cursorError);
      } else {
        await generateAfterCompletion(supabase, params.tenantId, {
          ...agreement,
          next_due_date: planned.occurrenceDate,
        }, completedOn);
      }
    }
  }

  const payment = await recordOptionalPayment(supabase, {
    tenantId: params.tenantId,
    customerId: job.customer_id,
    jobId: job.id,
    payment: params.payment,
    clientMutationId: params.clientMutationId,
    userId,
  });
  if (!payment.ok) {
    return {
      success: false,
      error:
        params.alreadyDonePayment === 'ignore'
          ? "Visit marked done, but the payment could not be saved. Record it with Mark as paid on the customer's page."
          : 'Visit marked done, but the payment could not be saved. Try again.',
      // Only a retry that can actually record it is worth repeating (the
      // replay lands in completeWhenAlreadyDone with the same clientMutationId).
      retryable: payment.retryable && params.alreadyDonePayment !== 'ignore',
    };
  }

  await afterVisitCompleted(supabase, {
    tenantId: params.tenantId,
    jobId: job.id,
    customerId: job.customer_id,
    sendInvoice: params.sendInvoice,
  });

  return {
    success: true,
    alreadyCompleted: false,
    skippedElsewhere: false,
    paymentId: payment.paymentId,
    paymentDuplicate: payment.paymentDuplicate,
  };
}

function skipResultForClosed(status: string | null): SkipVisitResult | null {
  if (status === 'cancelled') return { success: true, alreadySkipped: true };
  if (status === 'completed') {
    return {
      success: false,
      error: 'This visit is already done.',
      code: 'already_completed',
    };
  }
  return null;
}

export async function skipVisitCore(
  supabase: SupabaseClient,
  params: {
    tenantId: string;
    jobId: string;
    reason: SkipReason;
    note?: string | null;
    actor: Actor;
  },
): Promise<SkipVisitResult> {
  const loaded = await loadJobChecked(supabase, params.tenantId, params.jobId);
  if (!loaded.ok) {
    return { success: false, error: 'Could not load the visit. Try again.', retryable: true };
  }
  const job = loaded.job;
  if (!job) return { success: false, error: 'Visit not found.' };
  const closed = skipResultForClosed(job.status);
  if (closed) return closed;

  const note = params.note?.trim() ? params.note.trim() : null;
  // Conditional on the visit still being open: Done beats Skip, so a Done that
  // landed since loadJob must never be turned back into a skip.
  const { data: updated, error } = await supabase
    .from('jobs')
    .update({
      status: 'cancelled',
      skip_reason: params.reason,
      completion_notes: note,
      route_position: null,
    })
    .eq('id', job.id)
    .eq('tenant_id', params.tenantId)
    .not('status', 'in', CLOSED_STATUSES)
    .select('id');
  if (error) {
    console.error('[skipVisitCore] update error:', error);
    return { success: false, error: 'Failed to skip visit. Try again.', retryable: true };
  }
  if (!Array.isArray(updated) || updated.length === 0) {
    const again = await loadJobChecked(supabase, params.tenantId, job.id);
    if (!again.ok) {
      return { success: false, error: 'Could not load the visit. Try again.', retryable: true };
    }
    return (
      skipResultForClosed(again.job?.status ?? null) ?? {
        success: false,
        error: 'Could not skip this visit.',
      }
    );
  }

  await writeHistory(supabase, {
    jobId: job.id,
    fromStatus: job.status,
    toStatus: 'cancelled',
    notes: 'Visit skipped',
    metadata: { skip_reason: params.reason, note },
    actor: params.actor,
  });

  if (job.service_agreement_id && job.scheduled_date) {
    const agreement = await loadAgreement(
      supabase,
      params.tenantId,
      job.service_agreement_id,
    );
    if (agreement?.schedule_mode === 'after_completion' && agreement.status === 'active') {
      const nextDueDate = nextDueAfter(job.scheduled_date, agreement.frequency_days);
      const { error: cursorError } = await supabase
        .from('service_agreements')
        .update({ next_due_date: nextDueDate })
        .eq('id', agreement.id)
        .eq('tenant_id', params.tenantId);
      if (cursorError) {
        console.error('[skipVisitCore] next_due_date update:', cursorError);
      } else {
        await generateAfterCompletion(supabase, params.tenantId, {
          ...agreement,
          next_due_date: nextDueDate,
        }, todayInLondon());
      }
    }
  }

  return { success: true, alreadySkipped: false };
}

async function applyScheduleMove(
  supabase: SupabaseClient,
  params: {
    tenantId: string;
    job: JobRow;
    scheduledDate: Ymd;
    scheduledTime?: string | null;
    actor: Actor;
    historyNotes: string;
  },
): Promise<TransitionResult> {
  const time = normaliseTime(params.scheduledTime);
  const updates: Record<string, unknown> = {
    scheduled_date: params.scheduledDate,
    route_position: null,
  };
  if (time !== undefined) updates.scheduled_time = time;

  const { error } = await supabase
    .from('jobs')
    .update(updates)
    .eq('id', params.job.id)
    .eq('tenant_id', params.tenantId);
  if (error) {
    return { success: false, error: error.message ?? 'Failed to reschedule visit.' };
  }

  await writeHistory(supabase, {
    jobId: params.job.id,
    fromStatus: params.job.status,
    toStatus: params.job.status,
    notes: params.historyNotes,
    metadata: {
      from: params.job.scheduled_date,
      to: params.scheduledDate,
    },
    actor: params.actor,
  });
  return { success: true };
}

export async function rescheduleVisitCore(
  supabase: SupabaseClient,
  params: {
    tenantId: string;
    jobId: string;
    scheduledDate: Ymd;
    scheduledTime?: string | null;
    actor: Actor;
  },
): Promise<TransitionResult> {
  if (!isValidYmd(params.scheduledDate)) {
    return { success: false, error: 'Pick a valid date.' };
  }
  const job = await loadJob(supabase, params.tenantId, params.jobId);
  if (!job) return { success: false, error: 'Visit not found.' };
  if (!isRescheduleStatus(job.status)) {
    return { success: false, error: 'This visit cannot be rescheduled.' };
  }

  return applyScheduleMove(supabase, {
    tenantId: params.tenantId,
    job,
    scheduledDate: params.scheduledDate,
    scheduledTime: params.scheduledTime,
    actor: params.actor,
    historyNotes: `Rescheduled from ${job.scheduled_date ?? 'unscheduled'} to ${params.scheduledDate}`,
  });
}

export async function moveRemainingCore(
  supabase: SupabaseClient,
  params: {
    tenantId: string;
    fromDate: Ymd;
    toDate: Ymd;
    scheduledTime?: string | null;
    actor: Actor;
  },
): Promise<{ success: true; moved: number } | { success: false; error: string }> {
  if (!isValidYmd(params.fromDate) || !isValidYmd(params.toDate)) {
    return { success: false, error: 'Pick a valid date.' };
  }
  if (params.fromDate === params.toDate) {
    return { success: true, moved: 0 };
  }

  const { data, error } = await supabase
    .from('jobs')
    .select(
      'id, status, scheduled_date, scheduled_time, service_agreement_id, route_position, customer_id',
    )
    .eq('tenant_id', params.tenantId)
    .eq('scheduled_date', params.fromDate)
    .in('status', [...RESCHEDULE_STATUSES]);

  if (error) {
    return { success: false, error: error.message ?? 'Failed to load leftover stops.' };
  }

  const jobs: JobRow[] = [];
  for (const raw of data ?? []) {
    const row = raw as unknown as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id : null;
    const status = typeof row.status === 'string' ? row.status : null;
    if (!id || !status) continue;
    jobs.push({
      id,
      status,
      scheduled_date: asYmd(row.scheduled_date),
      scheduled_time: typeof row.scheduled_time === 'string' ? row.scheduled_time : null,
      service_agreement_id:
        typeof row.service_agreement_id === 'string' ? row.service_agreement_id : null,
      route_position: asFiniteNumber(row.route_position),
      customer_id: typeof row.customer_id === 'string' ? row.customer_id : null,
    });
  }

  let moved = 0;
  for (const job of jobs) {
    const result = await applyScheduleMove(supabase, {
      tenantId: params.tenantId,
      job,
      scheduledDate: params.toDate,
      scheduledTime: params.scheduledTime,
      actor: params.actor,
      historyNotes: `Moved remaining from ${params.fromDate} to ${params.toDate}`,
    });
    if (!result.success) return result;
    moved += 1;
  }

  return { success: true, moved };
}

export async function reorderDayCore(
  supabase: SupabaseClient,
  params: { tenantId: string; date: Ymd; orderedJobIds: string[] },
): Promise<TransitionResult> {
  if (!isValidYmd(params.date)) {
    return { success: false, error: 'Pick a valid date.' };
  }
  if (params.orderedJobIds.length === 0) {
    return { success: false, error: 'No stops to reorder.' };
  }
  if (new Set(params.orderedJobIds).size !== params.orderedJobIds.length) {
    return { success: false, error: 'Stop list contains duplicates.' };
  }

  const { data, error } = await supabase
    .from('jobs')
    .select('id, scheduled_date')
    .eq('tenant_id', params.tenantId)
    .eq('scheduled_date', params.date)
    .in('id', params.orderedJobIds);

  if (error) {
    return { success: false, error: error.message ?? 'Failed to load stops.' };
  }

  const found = new Set(
    (data ?? [])
      .map((row) => (typeof (row as { id?: unknown }).id === 'string' ? (row as { id: string }).id : null))
      .filter((id): id is string => id != null),
  );
  if (found.size !== params.orderedJobIds.length) {
    return { success: false, error: 'One or more stops are not on that day.' };
  }

  for (let i = 0; i < params.orderedJobIds.length; i++) {
    const { error: updateError } = await supabase
      .from('jobs')
      .update({ route_position: i + 1 })
      .eq('id', params.orderedJobIds[i])
      .eq('tenant_id', params.tenantId);
    if (updateError) {
      return { success: false, error: updateError.message ?? 'Failed to save order.' };
    }
  }

  return { success: true };
}

async function deleteJobRelatedRows(
  supabase: SupabaseClient,
  jobIds: string[],
): Promise<{ error: { message: string } | null }> {
  if (jobIds.length === 0) return { error: null };
  const { error: attErr } = await supabase.from('job_attachments').delete().in('job_id', jobIds);
  if (attErr) {
    console.error('[deleteUntouchedFutureVisits] job_attachments', attErr);
    return { error: attErr };
  }
  const { error: histErr } = await supabase
    .from('job_status_history')
    .delete()
    .in('job_id', jobIds);
  if (histErr) {
    console.error('[deleteUntouchedFutureVisits] job_status_history', histErr);
    return { error: histErr };
  }
  return { error: null };
}

export async function deleteUntouchedFutureVisits(
  supabase: SupabaseClient,
  params: { tenantId: string; agreementId: string; fromDate: Ymd; toDate?: Ymd },
): Promise<number> {
  let query = supabase
    .from('jobs')
    .select('id')
    .eq('tenant_id', params.tenantId)
    .eq('service_agreement_id', params.agreementId)
    .in('status', [...UNTOUCHED_STATUSES])
    .gte('scheduled_date', params.fromDate);
  if (params.toDate) {
    query = query.lte('scheduled_date', params.toDate);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message ?? 'Failed to load visits to delete.');
  }

  const ids = (data ?? [])
    .map((row) => (typeof (row as { id?: unknown }).id === 'string' ? (row as { id: string }).id : null))
    .filter((id): id is string => id != null);
  if (ids.length === 0) return 0;

  const related = await deleteJobRelatedRows(supabase, ids);
  if (related.error) {
    throw new Error(related.error.message);
  }

  const { error: delErr } = await supabase
    .from('jobs')
    .delete()
    .eq('tenant_id', params.tenantId)
    .in('id', ids);
  if (delErr) {
    throw new Error(delErr.message ?? 'Failed to delete visits.');
  }
  return ids.length;
}

export async function repriceUntouchedFutureVisits(
  supabase: SupabaseClient,
  params: { tenantId: string; agreementId: string; fromDate: Ymd; price: number },
): Promise<number> {
  const { data, error } = await supabase
    .from('jobs')
    .select('id')
    .eq('tenant_id', params.tenantId)
    .eq('service_agreement_id', params.agreementId)
    .in('status', [...UNTOUCHED_STATUSES])
    .gte('scheduled_date', params.fromDate);

  if (error) {
    throw new Error(error.message ?? 'Failed to load visits to reprice.');
  }

  const ids = (data ?? [])
    .map((row) => (typeof (row as { id?: unknown }).id === 'string' ? (row as { id: string }).id : null))
    .filter((id): id is string => id != null);
  if (ids.length === 0) return 0;

  const { error: updateError } = await supabase
    .from('jobs')
    .update({ quoted_amount: params.price })
    .eq('tenant_id', params.tenantId)
    .in('id', ids);
  if (updateError) {
    throw new Error(updateError.message ?? 'Failed to update prices.');
  }
  return ids.length;
}
