/**
 * Shared core for assigning one worker to many jobs (jobs-list bulk bar,
 * group assign). Lives outside the 'use server' module so it is not exposed
 * as a client-callable endpoint — it trusts the tenantId it is handed.
 */

import { revalidatePath } from 'next/cache';
import type { createClient } from '@/lib/supabase/server';
import { statusAfterWorkerAssignment } from '@/lib/jobs/worker-assignment-status';

export type BulkAssignJobsResult =
  | { success: true; assigned: number }
  | { success: false; error: string };

/**
 * Same status rules as assignJob — pending/pending_send/assigned/declined
 * move to pending_send; live statuses (in_progress etc.) keep their status
 * and only swap the worker. Validates the worker and that every job belongs
 * to the tenant.
 */
export async function assignWorkerToJobIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  jobIds: string[],
  workerId: string
): Promise<BulkAssignJobsResult> {
  const uniqueIds = [...new Set(jobIds)];
  if (!uniqueIds.length) {
    return { success: false, error: 'No jobs selected.' };
  }

  const { data: worker, error: workerFetchError } = await supabase
    .from('workers')
    .select('invite_status')
    .eq('id', workerId)
    .eq('primary_tenant_id', tenantId)
    .maybeSingle();

  if (workerFetchError || !worker) {
    return { success: false, error: 'Worker not found.' };
  }
  if (worker.invite_status !== 'accepted') {
    return { success: false, error: 'Worker has not accepted their invitation yet' };
  }

  const { data: rows, error: fetchError } = await supabase
    .from('jobs')
    .select('id, status')
    .eq('tenant_id', tenantId)
    .in('id', uniqueIds);

  if (fetchError) {
    return { success: false, error: fetchError.message };
  }
  if (!rows?.length) {
    return { success: false, error: 'No matching jobs found or access denied.' };
  }
  if (rows.length !== uniqueIds.length) {
    return { success: false, error: 'Some selected jobs were not found or access denied.' };
  }

  // One update per resulting status so each batch is a single statement.
  const byNewStatus = new Map<string, { id: string; from: string }[]>();
  for (const row of rows) {
    const from = (row.status as string) ?? 'pending';
    const to = statusAfterWorkerAssignment(from);
    const bucket = byNewStatus.get(to) ?? [];
    bucket.push({ id: row.id as string, from });
    byNewStatus.set(to, bucket);
  }

  const now = new Date().toISOString();
  for (const [newStatus, jobs] of byNewStatus) {
    const { error: updateError } = await supabase
      .from('jobs')
      .update({
        assigned_worker_id: workerId,
        status: newStatus,
        decline_reason: null,
        updated_at: now,
        auto_assign_failure_reason: null,
      })
      .eq('tenant_id', tenantId)
      .in(
        'id',
        jobs.map((j) => j.id)
      );

    if (updateError) {
      console.error('[assignWorkerToJobIds] update error:', updateError);
      if (updateError.code === '23503') {
        return { success: false, error: 'Worker not found.' };
      }
      return { success: false, error: updateError.message ?? 'Failed to assign worker.' };
    }
  }

  const { data: { user } } = await supabase.auth.getUser();
  const historyRows = [...byNewStatus].flatMap(([to, jobs]) =>
    jobs.map((j) => ({
      job_id: j.id,
      from_status: j.from,
      to_status: to,
      created_at: now,
      changed_by_user_id: user?.id ?? null,
      changed_by_worker_id: null,
      notes: 'Worker assigned',
      metadata: {},
    }))
  );
  const { error: historyError } = await supabase
    .from('job_status_history')
    .insert(historyRows);
  if (historyError) {
    console.error('[assignWorkerToJobIds] job_status_history insert error:', historyError);
  }

  revalidatePath('/jobs');
  for (const id of uniqueIds) {
    revalidatePath(`/jobs/${id}`);
  }
  return { success: true, assigned: uniqueIds.length };
}

