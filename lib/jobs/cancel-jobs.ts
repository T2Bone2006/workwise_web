import type { SupabaseClient } from '@supabase/supabase-js';
import { toSentJob, type SentJob } from '@/lib/jobs/worker-job-alert';

/**
 * The one place jobs are marked cancelled: the jobs page and Lily both come here, so a rule
 * added later (a notice, a record) is added once.
 *
 * Whether a job may be cancelled is the caller's call. This only writes, and only to a job
 * that is still in the status the caller saw, so a job that changed in between is left alone.
 * One update per starting status (not per job), then one history insert for the lot.
 */
export type CancelRequest = { id: string; status: string };

export type CancelJobsResult = { cancelledIds: string[]; error?: string };

export async function cancelJobsInDb(
  db: SupabaseClient,
  args: {
    tenantId: string;
    userId: string | null;
    jobs: readonly CancelRequest[];
    /** When the customer's cancellation reached the office (ISO), not when it was keyed in. */
    cancelledAt: string;
    /** Who did it, kept in the history ('assistant'). */
    via?: string;
    /** Leave the worker alert to the caller (tests). */
    skipWorkerAlert?: boolean;
  },
): Promise<CancelJobsResult> {
  const recordedAt = new Date().toISOString();
  const byStatus = new Map<string, string[]>();
  for (const j of args.jobs) {
    const ids = byStatus.get(j.status) ?? [];
    if (!ids.includes(j.id)) ids.push(j.id);
    byStatus.set(j.status, ids);
  }

  const done: Array<{ id: string; from: string }> = [];
  let error: string | undefined;
  for (const [status, ids] of byStatus) {
    const { data, error: upErr } = await db
      .from('jobs')
      .update({
        status: 'cancelled',
        // Drop it off an active round. Regular jobs already have a null position.
        route_position: null,
        updated_at: recordedAt,
      })
      .eq('tenant_id', args.tenantId)
      .eq('status', status)
      .in('id', ids)
      .select('id');
    if (upErr) {
      console.error('[cancelJobs] update', upErr);
      error = upErr.message ?? 'Failed to cancel.';
      continue;
    }
    for (const r of (data ?? []) as Array<{ id: unknown }>) done.push({ id: String(r.id), from: status });
  }

  if (done.length > 0) {
    const { error: historyError } = await db.from('job_status_history').insert(
      done.map((d) => ({
        job_id: d.id,
        from_status: d.from,
        to_status: 'cancelled',
        created_at: args.cancelledAt,
        changed_by_user_id: args.userId,
        changed_by_worker_id: null,
        notes: 'Cancelled',
        metadata: { cancelled_at: args.cancelledAt, recorded_at: recordedAt, ...(args.via ? { via: args.via } : {}) },
      })),
    );
    // The job is already cancelled: a missing history row must not undo that.
    if (historyError) console.error('[cancelJobs] history', historyError);
  }

  // A worker who had the job on their phone (sent, or already on site) is told it is off.
  // One that was only ready to send, or not given out yet, never knew about it.
  const told = done.filter((d) => d.from === 'assigned' || d.from === 'in_progress').map((d) => d.id);
  if (told.length > 0 && !args.skipWorkerAlert) await alertWorkersOfCancelled(db, args.tenantId, told);

  return { cancelledIds: done.map((d) => d.id), error };
}

/** Never throws: the jobs are already cancelled. */
async function alertWorkersOfCancelled(db: SupabaseClient, tenantId: string, jobIds: string[]): Promise<void> {
  try {
    const { data, error } = await db
      .from('jobs')
      .select('id, reference_number, assigned_worker_id, postcode, scheduled_date, scheduled_time, customers(name)')
      .eq('tenant_id', tenantId)
      .in('id', jobIds);
    if (error) {
      console.error('[cancelJobs] worker alert read', error);
      return;
    }
    const jobs = ((data ?? []) as Array<Record<string, unknown>>)
      .map((r) => toSentJob(r as Parameters<typeof toSentJob>[0]))
      .filter((j): j is SentJob => j !== null);
    // Loaded here, not at the top: the mail client needs its API key the moment it is imported.
    const { notifyWorkersOfCancelledJobs } = await import('@/lib/jobs/notify-sent-jobs');
    await notifyWorkersOfCancelledJobs({ tenantId, jobs });
  } catch (err) {
    console.error('[cancelJobs] worker alert', err instanceof Error ? err.message : 'error');
  }
}
