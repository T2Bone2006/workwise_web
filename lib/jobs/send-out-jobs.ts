import type { SupabaseClient } from '@supabase/supabase-js';
import { toSentJob, type SentJob } from '@/lib/jobs/worker-job-alert';

/**
 * The one place "Ready to send" jobs become "Sent to worker" and their workers are told.
 * The jobs page (send out, one job or many) and Lily both come here.
 *
 * Only jobs still Ready to send, with a worker, are touched. Pass `jobIds` to send just
 * those (selected rows, one job, Lily); leave it out to send everything ready.
 */
export type SendOutResult = { ok: true; sent: number; jobIds: string[] } | { ok: false; error: string };

export async function sendOutJobsInDb(
  db: SupabaseClient,
  args: { tenantId: string; userId: string | null; jobIds?: readonly string[]; via?: string },
): Promise<SendOutResult> {
  if (args.jobIds && args.jobIds.length === 0) return { ok: false, error: 'No jobs selected.' };

  let query = db
    .from('jobs')
    .select('id, reference_number, assigned_worker_id, postcode, scheduled_date, scheduled_time, customers(name)')
    .eq('tenant_id', args.tenantId)
    .eq('status', 'pending_send')
    .not('assigned_worker_id', 'is', null);
  if (args.jobIds) query = query.in('id', [...args.jobIds]);
  const { data: rows, error: listError } = await query;
  if (listError) {
    console.error('[sendOutJobs] list', listError);
    return { ok: false, error: listError.message ?? 'Failed to load jobs.' };
  }
  const list = (rows ?? []) as Array<Record<string, unknown>>;
  if (list.length === 0) return { ok: false, error: 'No jobs ready to send.' };

  const now = new Date().toISOString();
  // Still Ready to send at the moment of the update, or it is left alone. In chunks so a
  // long "send everything" list never makes the request address too long.
  const ids = list.map((r) => String(r.id));
  const updatedRows: Array<{ id: unknown }> = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data: updated, error: upErr } = await db
      .from('jobs')
      .update({ status: 'assigned', updated_at: now })
      .eq('tenant_id', args.tenantId)
      .eq('status', 'pending_send')
      .in('id', ids.slice(i, i + 100))
      .select('id');
    if (upErr) {
      console.error('[sendOutJobs] update', upErr);
      if (updatedRows.length === 0) return { ok: false, error: upErr.message ?? 'Failed to send jobs.' };
      break;
    }
    updatedRows.push(...((updated ?? []) as Array<{ id: unknown }>));
  }
  const sentIds = new Set(updatedRows.map((r) => String(r.id)));
  if (sentIds.size === 0) return { ok: false, error: 'No jobs ready to send.' };

  const { error: historyError } = await db.from('job_status_history').insert(
    [...sentIds].map((id) => ({
      job_id: id,
      from_status: 'pending_send',
      to_status: 'assigned',
      created_at: now,
      changed_by_user_id: args.userId,
      changed_by_worker_id: null,
      notes: 'Sent to worker',
      metadata: args.via ? { via: args.via } : {},
    })),
  );
  if (historyError) console.error('[sendOutJobs] history', historyError);

  const sentJobs = list
    .filter((r) => sentIds.has(String(r.id)))
    .map((r) => toSentJob(r as Parameters<typeof toSentJob>[0]))
    .filter((j): j is SentJob => j !== null);
  // Loaded here, not at the top: the mail client needs its API key the moment it is imported.
  const { notifyWorkersOfSentJobs } = await import('@/lib/jobs/notify-sent-jobs');
  await notifyWorkersOfSentJobs({ tenantId: args.tenantId, jobs: sentJobs });

  return { ok: true, sent: sentIds.size, jobIds: [...sentIds] };
}
