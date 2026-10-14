import 'server-only';

import { randomUUID } from 'node:crypto';
import { FROM_EMAIL, resend } from '@/lib/resend';
import { sendText } from '@/lib/messaging/provider';
import { createAdminClient } from '@/lib/supabase/admin';
import type { TenantSettings } from '@/lib/data/settings-types';
import { sendJobsAssignedPushToWorker } from '@/lib/services/worker-push';
import {
  WORKER_ALERT_SENDER,
  groupSentJobs,
  jobAlertEmail,
  jobAlertSms,
  proTierForJobTexts,
  shouldEmailJobAlert,
  shouldTextJobAlert,
  ukMobileForAlert,
  workerJobTextAllowance,
  type SentJob,
} from '@/lib/jobs/worker-job-alert';

type Admin = ReturnType<typeof createAdminClient>;

type WorkerAlertRow = {
  id: string;
  email: string | null;
  phone: string | null;
  expo_push_token: string | null;
  notify_job_email: boolean;
  notify_job_sms: boolean;
};

/**
 * One email and one app notification per worker for this send.
 * A text only when that worker turned it on, from the name WorkWise,
 * counted on the Pro allowance (not customer texts).
 * Never throws: the jobs are already marked sent.
 */
export async function notifyWorkersOfSentJobs(args: {
  tenantId: string;
  jobs: readonly SentJob[];
  db?: Admin;
}): Promise<void> {
  if (args.jobs.length === 0) return;

  let db: Admin;
  try {
    db = args.db ?? createAdminClient();
  } catch (err) {
    console.error('[job-alert] no admin client', err instanceof Error ? err.message : 'error');
    return;
  }

  try {
    const groups = groupSentJobs(args.jobs);
    const workerIds = groups.map((group) => group[0]!.workerId);
    const [tenant, workers, tier] = await Promise.all([
      loadTenant(db, args.tenantId),
      loadWorkers(db, workerIds),
      loadTier(db, args.tenantId),
    ]);
    const allowance = workerJobTextAllowance(tier);
    const byId = new Map(workers.map((worker) => [worker.id, worker]));

    for (const group of groups) {
      const worker = byId.get(group[0]!.workerId);
      if (!worker) continue;
      await alertWorker({
        db,
        tenantId: args.tenantId,
        businessName: tenant.name,
        pushEnabled: tenant.pushEnabled,
        worker,
        jobs: group,
        allowance,
      });
    }
  } catch (err) {
    console.error('[job-alert]', err instanceof Error ? err.message : 'error');
  }
}

async function alertWorker(args: {
  db: Admin;
  tenantId: string;
  businessName: string;
  pushEnabled: boolean;
  worker: WorkerAlertRow;
  jobs: SentJob[];
  allowance: number | null;
}): Promise<void> {
  const mobile = ukMobileForAlert(args.worker.phone);
  const wantsText = shouldTextJobAlert({
    notifySms: args.worker.notify_job_sms,
    hasUkMobile: mobile != null,
    allowance: args.allowance,
  });

  let allowanceUsedUp = false;
  if (wantsText && mobile) {
    allowanceUsedUp = await sendJobText({
      db: args.db,
      tenantId: args.tenantId,
      workerId: args.worker.id,
      to: mobile,
      body: jobAlertSms(args.businessName, args.jobs.length),
      allowance: args.allowance ?? 0,
    });
  }

  const email = args.worker.email?.trim() || '';
  if (
    shouldEmailJobAlert({
      notifyEmail: args.worker.notify_job_email,
      hasEmail: email.length > 0,
      allowanceUsedUp,
    })
  ) {
    const message = jobAlertEmail({ businessName: args.businessName, jobs: args.jobs });
    try {
      const { error } = await resend.emails.send({
        from: FROM_EMAIL,
        to: email,
        subject: message.subject,
        html: message.html,
      });
      if (error) console.error('[job-alert] email failed', args.worker.id);
    } catch (err) {
      console.error('[job-alert] email failed', args.worker.id, err instanceof Error ? err.message : 'error');
    }
  }

  if (!args.pushEnabled) return;
  try {
    await sendJobsAssignedPushToWorker({
      token: args.worker.expo_push_token,
      jobs: args.jobs.map((job) => ({ jobId: job.id, referenceNumber: job.referenceNumber })),
    });
  } catch (err) {
    console.error('[job-alert] push failed', args.worker.id, err instanceof Error ? err.message : 'error');
  }
}

/** Returns true when the allowance is used up (the email should stand in). */
async function sendJobText(args: {
  db: Admin;
  tenantId: string;
  workerId: string;
  to: string;
  body: string;
  allowance: number;
}): Promise<boolean> {
  const { data, error } = await args.db.rpc('claim_worker_job_text', {
    p_tenant_id: args.tenantId,
    p_segments: 1,
    p_allowance: args.allowance,
  });
  if (error) {
    console.error('[job-alert] text claim failed', args.workerId);
    return false;
  }
  if (data !== 'allowance') return data === 'none';

  try {
    const result = await sendText({
      to: args.to,
      body: args.body,
      clientReference: randomUUID(),
      sender: WORKER_ALERT_SENDER,
    });
    if (result.ok) return false;
    console.error('[job-alert] text failed', args.workerId);
  } catch (err) {
    console.error('[job-alert] text failed', args.workerId, err instanceof Error ? err.message : 'error');
  }

  const refund = await args.db.rpc('refund_worker_job_text', {
    p_tenant_id: args.tenantId,
    p_segments: 1,
  });
  if (refund.error) console.error('[job-alert] text refund failed', args.workerId);
  return false;
}

async function loadTenant(
  db: Admin,
  tenantId: string,
): Promise<{ name: string; pushEnabled: boolean }> {
  const { data, error } = await db
    .from('tenants')
    .select('name, settings')
    .eq('id', tenantId)
    .maybeSingle();
  if (error || !data) return { name: 'Your office', pushEnabled: true };
  const settings = data.settings as TenantSettings | null;
  return {
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'Your office',
    pushEnabled: settings?.notifications?.worker?.push_when_job_assigned !== false,
  };
}

async function loadTier(db: Admin, tenantId: string) {
  const { data, error } = await db
    .from('subscriptions')
    .select('product, status')
    .eq('tenant_id', tenantId);
  if (error || !data) return null;
  return proTierForJobTexts(data);
}

async function loadWorkers(db: Admin, workerIds: string[]): Promise<WorkerAlertRow[]> {
  const full = await db
    .from('workers')
    .select('id, email, phone, expo_push_token, notify_job_email, notify_job_sms')
    .in('id', workerIds);
  if (!full.error) {
    return (full.data ?? []).map((row) => ({
      id: String(row.id),
      email: typeof row.email === 'string' ? row.email : null,
      phone: typeof row.phone === 'string' ? row.phone : null,
      expo_push_token: typeof row.expo_push_token === 'string' ? row.expo_push_token : null,
      notify_job_email: row.notify_job_email !== false,
      notify_job_sms: row.notify_job_sms === true,
    }));
  }

  // Columns are not there until the owner pastes the migration. Email stays on, text stays off.
  if (!String(full.error.message ?? '').includes('notify_job_')) {
    console.error('[job-alert] workers', full.error.message);
    return [];
  }
  const basic = await db.from('workers').select('id, email, phone, expo_push_token').in('id', workerIds);
  if (basic.error || !basic.data) return [];
  return basic.data.map((row) => ({
    id: String(row.id),
    email: typeof row.email === 'string' ? row.email : null,
    phone: typeof row.phone === 'string' ? row.phone : null,
    expo_push_token: typeof row.expo_push_token === 'string' ? row.expo_push_token : null,
    notify_job_email: true,
    notify_job_sms: false,
  }));
}
