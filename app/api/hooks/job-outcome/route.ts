import { NextResponse } from 'next/server';
import {
  getTenantNotificationRecipients,
} from '@/lib/jobs/job-outcome-summary';
import {
  hasAutomaticOutcomeEmail,
  sendJobOutcomeEmail,
} from '@/lib/jobs/send-job-outcome-email';

/**
 * Receives the Supabase database webhook on `jobs` UPDATE and emails the
 * tenant when a job ends badly — declined, or a report submitted saying the
 * work was not done. Never for a completed job.
 *
 * Fires from the database rather than the apps so it works wherever the change
 * came from: the worker's phone, the dashboard, or an offline report syncing
 * back hours later.
 */

const OUTCOMES_THAT_EMAIL = new Set(['declined', 'incomplete']);

type WebhookPayload = {
  type?: string;
  table?: string;
  record?: Record<string, unknown> | null;
  old_record?: Record<string, unknown> | null;
};

export async function POST(request: Request) {
  const secret = process.env.JOB_OUTCOME_HOOK_SECRET;
  if (!secret) {
    console.error('[job-outcome hook] JOB_OUTCOME_HOOK_SECRET is not set');
    return NextResponse.json({ error: 'Not configured' }, { status: 500 });
  }
  if (request.headers.get('x-workwise-hook-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = (await request.json()) as WebhookPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const record = payload.record ?? null;
  const previous = payload.old_record ?? null;
  if (!record) {
    return NextResponse.json({ skipped: 'no record' });
  }

  const status = String(record.status ?? '');
  const previousStatus = previous ? String(previous.status ?? '') : null;

  // Only on the transition itself. `sync_network_job_status_fn` writes the same
  // status onto the canonical job, and `update_jobs_updated_at` touches the row
  // again — neither is a new outcome.
  if (!OUTCOMES_THAT_EMAIL.has(status) || status === previousStatus) {
    return NextResponse.json({ skipped: 'not an outcome transition' });
  }

  const jobId = String(record.id ?? '');
  const tenantId = String(record.tenant_id ?? '');
  if (!jobId || !tenantId) {
    return NextResponse.json({ error: 'Missing job or tenant id' }, { status: 400 });
  }

  if (await hasAutomaticOutcomeEmail(jobId)) {
    return NextResponse.json({ skipped: 'already sent' });
  }

  const recipients = await getTenantNotificationRecipients(tenantId);
  if (recipients.length === 0) {
    console.error('[job-outcome hook] no recipient for tenant', tenantId);
    return NextResponse.json({ skipped: 'no recipient' });
  }

  const result = await sendJobOutcomeEmail({
    jobId,
    recipients,
    automatic: true,
  });

  // Always 200: the send is logged either way, and a non-2xx would make
  // Supabase retry a job whose status change has already committed.
  return NextResponse.json({ sent: result.sent, error: result.error ?? null });
}
