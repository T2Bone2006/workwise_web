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

export type CompleteVisitResult =
  | {
      success: true;
      alreadyCompleted: boolean;
      skippedElsewhere: boolean;
      paymentId: string | null;
      paymentDuplicate: boolean;
    }
  | { success: false; error: string };

export type SkipVisitResult =
  | { success: true; alreadySkipped: boolean }
  | { success: false; error: string; code?: 'already_completed' };

export const UNTOUCHED_STATUSES = ['assigned'] as const;

export const RESCHEDULE_STATUSES = [
  'assigned',
  'accepted',
  'en_route',
  'arrived',
  'in_progress',
  'paused',
] as const;

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

async function loadJob(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
): Promise<JobRow | null> {
  const { data, error } = await supabase
    .from('jobs')
    .select(
      'id, status, scheduled_date, scheduled_time, service_agreement_id, route_position, customer_id',
    )
    .eq('id', jobId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error || !data) return null;
  const id = typeof data.id === 'string' ? data.id : null;
  const status = typeof data.status === 'string' ? data.status : null;
  if (!id || !status) return null;
  return {
    id,
    status,
    scheduled_date: asYmd(data.scheduled_date),
    scheduled_time: typeof data.scheduled_time === 'string' ? data.scheduled_time : null,
    service_agreement_id:
      typeof data.service_agreement_id === 'string' ? data.service_agreement_id : null,
    route_position: asFiniteNumber(data.route_position),
    customer_id: typeof data.customer_id === 'string' ? data.customer_id : null,
  };
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

async function writeHistory(
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
  | { ok: false; error: string }
> {
  if (!params.payment) {
    return { ok: true, paymentId: null, paymentDuplicate: false };
  }
  if (!params.customerId) {
    return { ok: false, error: 'Could not record the payment.' };
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
    return { ok: false, error: result.error };
  }
  return {
    ok: true,
    paymentId: result.paymentId,
    paymentDuplicate: result.duplicate,
  };
}

export async function completeVisitCore(
  supabase: SupabaseClient,
  params: {
    tenantId: string;
    jobId: string;
    finalAmount?: number | null;
    notes?: string | null;
    actor: Actor;
    payment?: CompleteVisitPayment | null;
    sendInvoice?: boolean | null;
    clientMutationId?: string | null;
    completedAt?: string | null;
  },
): Promise<CompleteVisitResult> {
  const job = await loadJob(supabase, params.tenantId, params.jobId);
  if (!job) return { success: false, error: 'Visit not found.' };

  const completedAt = clampCompletedAt(params.completedAt);
  const userId = params.actor.userId ?? null;

  // Skipped elsewhere — keep any cash as credit against this job id.
  if (job.status === 'cancelled') {
    const payment = await recordOptionalPayment(supabase, {
      tenantId: params.tenantId,
      customerId: job.customer_id,
      jobId: job.id,
      payment: params.payment,
      clientMutationId: params.clientMutationId,
      userId,
    });
    if (!payment.ok) {
      return { success: false, error: payment.error };
    }
    return {
      success: true,
      alreadyCompleted: false,
      skippedElsewhere: true,
      paymentId: payment.paymentId,
      paymentDuplicate: payment.paymentDuplicate,
    };
  }

  // Already done — idempotent replay: payment + sendInvoice + after hooks only.
  if (job.status === 'completed') {
    const payment = await recordOptionalPayment(supabase, {
      tenantId: params.tenantId,
      customerId: job.customer_id,
      jobId: job.id,
      payment: params.payment,
      clientMutationId: params.clientMutationId,
      userId,
    });
    if (!payment.ok) {
      return { success: false, error: payment.error };
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

  const { error } = await supabase
    .from('jobs')
    .update(updates)
    .eq('id', job.id)
    .eq('tenant_id', params.tenantId);
  if (error) {
    return { success: false, error: error.message ?? 'Failed to complete visit.' };
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
        'Visit marked done, but the payment could not be saved. Try again.',
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
  const job = await loadJob(supabase, params.tenantId, params.jobId);
  if (!job) return { success: false, error: 'Visit not found.' };
  if (job.status === 'cancelled') {
    return { success: true, alreadySkipped: true };
  }
  if (job.status === 'completed') {
    return {
      success: false,
      error: 'This visit is already done.',
      code: 'already_completed',
    };
  }

  const note = params.note?.trim() ? params.note.trim() : null;
  const { error } = await supabase
    .from('jobs')
    .update({
      status: 'cancelled',
      skip_reason: params.reason,
      completion_notes: note,
      route_position: null,
    })
    .eq('id', job.id)
    .eq('tenant_id', params.tenantId);
  if (error) {
    return { success: false, error: error.message ?? 'Failed to skip visit.' };
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
