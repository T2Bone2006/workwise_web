'use server';

import { revalidatePath } from 'next/cache';
import { getWorkerLink } from '@/lib/auth/worker-link';
import { getWorkerRoundsExtras } from '@/lib/data/worker/rounds-extras';
import { createClient } from '@/lib/supabase/server';
import { RESPOND_MESSAGES, cleanDeclineReason, isJobId, type RespondResult } from '@/lib/worker/respond';

/**
 * Accept or decline a job from the website. These are the same two writes the phone makes, made with the
 * worker's own session, so the database's rules decide what they may touch. The update is also pinned to
 * "assigned to me and still waiting", so a stale page, a double click or a job the office has moved on
 * changes nothing and says so. The decline trigger writes the history row and hands the job back.
 */
async function respond(
  jobId: unknown,
  patch: { status: 'accepted' } | { status: 'declined'; decline_reason: string | null },
): Promise<RespondResult> {
  if (!isJobId(jobId)) return { ok: false, error: RESPOND_MESSAGES.badJob };

  const link = await getWorkerLink();
  if (!link) return { ok: false, error: RESPOND_MESSAGES.notConnected };
  if ((await getWorkerRoundsExtras()).employerIsRounds) return { ok: false, error: RESPOND_MESSAGES.visit };

  const supabase = await createClient();
  const { error, count } = await supabase
    .from('jobs')
    .update(patch, { count: 'exact' })
    .eq('id', jobId)
    .eq('assigned_worker_id', link.workerId)
    .eq('status', 'assigned');

  if (error) {
    console.error('[worker/respond]', patch.status, error.message?.slice(0, 120) ?? '');
    return { ok: false, error: RESPOND_MESSAGES.failed };
  }
  if (!count) return { ok: false, error: RESPOND_MESSAGES.changed };

  revalidatePath('/worker', 'layout');
  return { ok: true };
}

export async function acceptJobAction(jobId: string): Promise<RespondResult> {
  return respond(jobId, { status: 'accepted' });
}

export async function declineJobAction(jobId: string, reason?: string): Promise<RespondResult> {
  return respond(jobId, { status: 'declined', decline_reason: cleanDeclineReason(reason) });
}
