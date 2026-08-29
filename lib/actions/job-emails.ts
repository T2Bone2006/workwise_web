'use server';

import { createClient } from '@/lib/supabase/server';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { sendJobOutcomeEmail } from '@/lib/jobs/send-job-outcome-email';

/** Only a job that has reached the end of its cycle has anything to report. */
const SENDABLE_STATUSES = new Set(['completed', 'incomplete', 'declined']);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Sends the job summary to an address the dispatcher picks — usually the end
 * customer, so they can re-plan. Same template as the automatic outcome email.
 */
export async function sendJobSummaryToRecipient(params: {
  jobId: string;
  recipient: string;
  note?: string;
}): Promise<{ success: boolean; error?: string }> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) {
    return { success: false, error: 'Not authenticated' };
  }

  const recipient = params.recipient.trim();
  if (!EMAIL_RE.test(recipient)) {
    return { success: false, error: 'Enter a valid email address' };
  }

  // Confirms the job is this tenant's, and that it is far enough along to
  // describe. Reads through the user session, so RLS scopes it.
  const supabase = await createClient();
  const { data: job, error } = await supabase
    .from('jobs')
    .select('id, status')
    .eq('id', params.jobId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) {
    console.error('[sendJobSummaryToRecipient]', error);
    return { success: false, error: error.message };
  }
  if (!job) {
    return { success: false, error: 'Job not found' };
  }
  if (!SENDABLE_STATUSES.has(String(job.status))) {
    return { success: false, error: 'This job has not finished yet' };
  }

  const result = await sendJobOutcomeEmail({
    jobId: params.jobId,
    recipients: [recipient],
    note: params.note?.trim() || null,
    automatic: false,
  });

  if (!result.sent) {
    return { success: false, error: result.error ?? 'Could not send the email' };
  }
  return { success: true };
}
