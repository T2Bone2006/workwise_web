import { createAdminClient } from '@/lib/supabase/admin';
import { resend, FROM_EMAIL } from '@/lib/resend';
import { buildJobOutcomeEmail } from '@/lib/emails/job-outcome';
import { getJobOutcomeSummary } from '@/lib/jobs/job-outcome-summary';

/** `notifications.type` for these. Also the idempotency key for automatic sends. */
export const JOB_OUTCOME_NOTIFICATION_TYPE = 'job_outcome';
export const JOB_OUTCOME_MANUAL_TYPE = 'job_outcome_manual';

export interface SendJobOutcomeEmailParams {
  jobId: string;
  recipients: string[];
  /** Optional line from the sender, shown above the summary. Manual sends only. */
  note?: string | null;
  automatic: boolean;
}

/**
 * Builds and sends the outcome summary, then records the attempt in
 * `notifications` — which already carries delivery state, provider id and
 * failure reason, so retries and an audit trail come for free.
 *
 * Failures are recorded rather than thrown: an email that does not go out must
 * not roll back or retry the status change that triggered it.
 */
export async function sendJobOutcomeEmail({
  jobId,
  recipients,
  note = null,
  automatic,
}: SendJobOutcomeEmailParams): Promise<{ sent: boolean; error?: string }> {
  const cleanRecipients = [
    ...new Set(recipients.map((r) => r.trim()).filter(Boolean)),
  ];
  if (cleanRecipients.length === 0) {
    return { sent: false, error: 'No recipient address' };
  }

  const { summary, error: summaryError } = await getJobOutcomeSummary(jobId);
  if (!summary) {
    return { sent: false, error: summaryError ?? 'Could not load the job' };
  }

  const { subject, html } = buildJobOutcomeEmail({ summary, note });
  const admin = createAdminClient();
  const type = automatic ? JOB_OUTCOME_NOTIFICATION_TYPE : JOB_OUTCOME_MANUAL_TYPE;

  let providerMessageId: string | null = null;
  let failedReason: string | null = null;

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: cleanRecipients,
      subject,
      html,
    });
    if (error) {
      failedReason = error.message;
    } else {
      providerMessageId = data?.id ?? null;
    }
  } catch (err) {
    failedReason = err instanceof Error ? err.message : String(err);
  }

  const { error: logError } = await admin.from('notifications').insert({
    tenant_id: summary.tenantId,
    recipient_type: automatic ? 'tenant' : 'external',
    recipient_email: cleanRecipients.join(', '),
    type,
    channel: 'email',
    subject,
    body: html,
    job_id: jobId,
    status: failedReason ? 'failed' : 'sent',
    sent_at: failedReason ? null : new Date().toISOString(),
    failed_reason: failedReason,
    provider: 'resend',
    provider_message_id: providerMessageId,
  });

  if (logError) {
    console.error('[sendJobOutcomeEmail] notifications insert:', logError);
  }

  if (failedReason) {
    console.error('[sendJobOutcomeEmail] resend:', failedReason);
    return { sent: false, error: failedReason };
  }
  return { sent: true };
}

/**
 * True when an automatic outcome email has already gone out for this job.
 *
 * Supabase can deliver a webhook more than once, and the trigger chain can fire
 * a second UPDATE on the same row — neither should produce a second email.
 */
export async function hasAutomaticOutcomeEmail(jobId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('notifications')
    .select('id')
    .eq('job_id', jobId)
    .eq('type', JOB_OUTCOME_NOTIFICATION_TYPE)
    .eq('status', 'sent')
    .limit(1);

  if (error) {
    // Better a duplicate email than a silently missing one.
    console.error('[hasAutomaticOutcomeEmail]', error);
    return false;
  }
  return (data ?? []).length > 0;
}
