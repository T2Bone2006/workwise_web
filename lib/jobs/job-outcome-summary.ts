import { createAdminClient } from '@/lib/supabase/admin';
import {
  parseWorkerVisibleFields,
  resolveJobSheetFields,
} from '@/lib/jobs/worker-visible-fields';

export type JobOutcome = 'completed' | 'incomplete' | 'declined';

export interface LabelledValue {
  label: string;
  value: string;
}

export interface JobOutcomeSummary {
  tenantId: string;
  tenantName: string;
  jobId: string;
  reference: string;
  outcome: JobOutcome;
  /** Why it stopped. Null for a completed job. */
  reason: string | null;
  address: string;
  postcode: string;
  customerName: string | null;
  workerName: string | null;
  scheduled: string | null;
  startedAt: string | null;
  endedAt: string | null;
  /** Answers from the completion form, in the tenant's own configured order. */
  reportAnswers: LabelledValue[];
  /** The customer's chosen job sheet fields — the same ones the worker saw. */
  jobSheetFields: LabelledValue[];
  photoUrls: string[];
}

/** Built into the worker app for every tenant, so they have no configured label. */
const BUILT_IN_REPORT_LABELS: Record<string, string> = {
  job_completed: 'Job completed?',
  incomplete_reason: 'Reason for not completing',
  job_notes: 'Job notes',
};

/** Keys that are surfaced elsewhere in the email, so would only read as noise. */
const SKIPPED_REPORT_KEYS = new Set(['pause_reason']);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function formatAnswer(value: unknown): string {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  if (value == null) return '';
  return String(value).trim();
}

function formatDateTime(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatScheduled(date: string | null, time: string | null): string | null {
  if (!date) return null;
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const dayPart = d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return time ? `${dayPart}, ${time.slice(0, 5)}` : dayPart;
}

/**
 * Turns the completion form's raw answers into labelled pairs, using the
 * tenant's own field config for the labels and its order for the ordering.
 *
 * Only answers that were actually given are included, which is also how
 * conditional fields (`show_when`) drop out — an unanswered follow-up simply
 * is not in `industry_data`.
 */
function buildReportAnswers(
  industryData: Record<string, unknown>,
  reportFields: unknown
): LabelledValue[] {
  const labels: Record<string, string> = { ...BUILT_IN_REPORT_LABELS };
  const order: string[] = ['job_completed', 'incomplete_reason'];

  if (Array.isArray(reportFields)) {
    for (const field of reportFields) {
      const candidate = asRecord(field);
      const id = typeof candidate.id === 'string' ? candidate.id : null;
      if (!id) continue;
      if (typeof candidate.label === 'string' && candidate.label.trim()) {
        labels[id] = candidate.label.trim();
      }
      if (!order.includes(id)) order.push(id);
    }
  }
  // Free-text notes read best last, after the structured answers.
  order.push('job_notes');

  const out: LabelledValue[] = [];
  const emitted = new Set<string>();

  const emit = (key: string) => {
    if (emitted.has(key) || SKIPPED_REPORT_KEYS.has(key)) return;
    if (!(key in industryData)) return;
    const value = formatAnswer(industryData[key]);
    if (!value) return;
    emitted.add(key);
    out.push({ label: labels[key] ?? key, value });
  };

  for (const key of order) emit(key);
  // Anything answered that the config no longer lists still belongs in the
  // record — a question removed from the form must not erase past answers.
  for (const key of Object.keys(industryData)) emit(key);

  return out;
}

/**
 * Everything needed to describe how a job ended, in one shape used by both the
 * automatic outcome email and the manual send from the dashboard.
 *
 * Runs with the service role: the webhook has no user session, and the manual
 * path checks the caller's tenant before calling this.
 */
export async function getJobOutcomeSummary(
  jobId: string
): Promise<{ summary: JobOutcomeSummary | null; error: string | null }> {
  const admin = createAdminClient();

  const { data: job, error: jobError } = await admin
    .from('jobs')
    .select(
      'id, tenant_id, reference_number, address, postcode, status, scheduled_date, scheduled_time, started_at, completed_at, industry_data, completion_notes, decline_reason, source_fields, assigned_worker_id, customer_id'
    )
    .eq('id', jobId)
    .maybeSingle();

  if (jobError) return { summary: null, error: jobError.message };
  if (!job) return { summary: null, error: 'Job not found' };

  const status = job.status as string;
  const outcome: JobOutcome =
    status === 'declined' ? 'declined' : status === 'incomplete' ? 'incomplete' : 'completed';

  const [tenantResult, customerResult, attachmentsResult] = await Promise.all([
    admin.from('tenants').select('name, settings').eq('id', job.tenant_id).maybeSingle(),
    job.customer_id
      ? admin
          .from('customers')
          .select('name, worker_visible_fields')
          .eq('id', job.customer_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin
      .from('job_attachments')
      .select('file_url, attachment_type, created_at')
      .eq('job_id', jobId)
      .order('created_at', { ascending: true }),
  ]);

  // Declining clears assigned_worker_id, so for that outcome the only record of
  // who it was is the status history row the decline trigger wrote.
  let workerId = job.assigned_worker_id as string | null;
  if (!workerId && outcome === 'declined') {
    const { data: historyRow } = await admin
      .from('job_status_history')
      .select('changed_by_worker_id')
      .eq('job_id', jobId)
      .eq('to_status', 'declined')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    workerId = (historyRow?.changed_by_worker_id as string | null) ?? null;
  }

  let workerName: string | null = null;
  if (workerId) {
    const { data: worker } = await admin
      .from('workers')
      .select('full_name')
      .eq('id', workerId)
      .maybeSingle();
    workerName = (worker?.full_name as string | null) ?? null;
  }

  const tenantSettings = asRecord(tenantResult.data?.settings);
  const industryData = asRecord(job.industry_data);

  const reason =
    outcome === 'declined'
      ? (job.decline_reason as string | null)?.trim() || null
      : outcome === 'incomplete'
        ? formatAnswer(industryData.incomplete_reason) ||
          formatAnswer(industryData.walk_away_reason) ||
          null
        : null;

  const jobSheetFields = resolveJobSheetFields(
    asRecord(job.source_fields) as Record<string, string>,
    parseWorkerVisibleFields(customerResult.data?.worker_visible_fields)
  );

  return {
    summary: {
      tenantId: job.tenant_id as string,
      tenantName: (tenantResult.data?.name as string) ?? 'WorkWise',
      jobId: job.id as string,
      reference: (job.reference_number as string) ?? job.id.slice(0, 8).toUpperCase(),
      outcome,
      reason,
      address: (job.address as string) ?? '',
      postcode: (job.postcode as string) ?? '',
      customerName: (customerResult.data?.name as string | null) ?? null,
      workerName,
      scheduled: formatScheduled(job.scheduled_date, job.scheduled_time),
      startedAt: formatDateTime(job.started_at),
      endedAt: formatDateTime(job.completed_at),
      reportAnswers: buildReportAnswers(industryData, tenantSettings.job_report_fields),
      jobSheetFields,
      photoUrls: (attachmentsResult.data ?? [])
        .map((row) => String((row as { file_url?: unknown }).file_url ?? '').trim())
        .filter(Boolean),
    },
    error: null,
  };
}

/**
 * Where an automatic outcome email goes: the address on the company profile,
 * falling back to the tenant's admin logins so a tenant that never filled in
 * Settings still gets told.
 */
export async function getTenantNotificationRecipients(
  tenantId: string
): Promise<string[]> {
  const admin = createAdminClient();

  const { data: tenant } = await admin
    .from('tenants')
    .select('settings')
    .eq('id', tenantId)
    .maybeSingle();

  const companyEmail = String(
    asRecord(asRecord(tenant?.settings).company).email ?? ''
  ).trim();
  if (companyEmail) return [companyEmail];

  const { data: admins } = await admin
    .from('users')
    .select('email')
    .eq('tenant_id', tenantId)
    .eq('role', 'admin')
    .eq('is_active', true);

  return (admins ?? [])
    .map((row) => String((row as { email?: unknown }).email ?? '').trim())
    .filter(Boolean);
}
