import { format, parseISO, isValid } from 'date-fns';
import type { ReactNode } from 'react';
import { FileQuestionMark, FileText, History, Paperclip } from 'lucide-react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { EmptyState } from '@/components/look/empty-state';
import { LookCard } from '@/components/look/look-card';
import { Tag } from '@/components/look/tag';
import { toneClasses, type Tone } from '@/components/look/tones';
import { PortalJobsBackLink } from '@/components/portal/portal-jobs-back-link';
import { JOB_STATUS_DISPLAY, type JobStatusUi } from '@/lib/job-status-display';
import { cn } from '@/lib/utils';

type StatusHistoryRow = {
  id: string;
  from_status: string | null;
  to_status: string;
  created_at: string;
};

type AttachmentRow = {
  id: string;
  file_name: string;
  file_url: string;
};

const STATUS_TONE: Record<string, Tone> = {
  pending: 'slate',
  pending_send: 'sky',
  assigned: 'amber',
  accepted: 'amber',
  in_progress: 'sky',
  paused: 'amber',
  completed: 'emerald',
  incomplete: 'amber',
  declined: 'rose',
  cancelled: 'rose',
};

function formatScheduledDateTime(dateStr: string | null, timeStr: string | null): string {
  if (!dateStr && !timeStr) return '—';
  const timeShort = timeStr && timeStr.length >= 5 ? timeStr.slice(0, 5) : null;
  if (dateStr) {
    const iso = dateStr.length <= 10 ? `${dateStr}T12:00:00` : dateStr;
    const d = parseISO(iso);
    if (!isValid(d)) return dateStr + (timeShort ? ` · ${timeShort}` : '');
    const datePart = format(d, 'd MMM yyyy');
    return timeShort ? `${datePart} at ${timeShort}` : datePart;
  }
  return timeShort ?? '—';
}

function formatWhen(iso: string): string {
  const d = parseISO(iso);
  if (!isValid(d)) return iso;
  return format(d, 'd MMM yyyy, HH:mm');
}

function statusLabel(status: string | null): string {
  if (!status) return 'Unknown';
  return JOB_STATUS_DISPLAY[status as JobStatusUi]?.label ?? status;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-t border-border py-3 first:border-t-0 first:pt-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 text-sm text-foreground">{children}</div>
    </div>
  );
}

interface PortalJobDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function PortalJobDetailPage({ params }: PortalJobDetailPageProps) {
  const { id: jobId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: portalRows } = await supabase
    .from('customer_portal_users')
    .select('customer_id')
    .eq('user_id', user.id);

  const allowedCustomerIds = (portalRows ?? []).map(
    (row: { customer_id: string }) => row.customer_id
  );

  if (allowedCustomerIds.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <PageGradientHeader title="Job not found" subtitle="You do not have access to this job." />
        <PortalJobsBackLink />
        <EmptyState
          icon={FileQuestionMark}
          title="No access"
          body="Your account is not linked to a customer, so this job cannot be opened."
        />
      </div>
    );
  }

  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select(
      `
      id,
      reference_number,
      address,
      status,
      scheduled_date,
      scheduled_time,
      job_description,
      completion_notes,
      customer_id
    `
    )
    .eq('id', jobId)
    .maybeSingle();

  if (
    jobError ||
    !job ||
    !job.customer_id ||
    !allowedCustomerIds.includes(job.customer_id as string)
  ) {
    return (
      <div className="flex flex-col gap-5">
        <PageGradientHeader
          title="Job not found"
          subtitle="This job does not exist or you do not have permission to view it."
        />
        <PortalJobsBackLink />
        <EmptyState
          icon={FileQuestionMark}
          title="Job not found"
          body="This job does not exist, or it belongs to a different customer."
        />
      </div>
    );
  }

  const [{ data: statusHistory }, { data: attachments }] = await Promise.all([
    supabase
      .from('job_status_history')
      .select('id, from_status, to_status, created_at')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false }),
    supabase
      .from('job_attachments')
      .select('id, file_name, file_url')
      .eq('job_id', jobId)
      .order('created_at', { ascending: true }),
  ]);

  const historyRows: StatusHistoryRow[] = Array.isArray(statusHistory)
    ? (statusHistory as StatusHistoryRow[])
    : [];
  const attachmentRows: AttachmentRow[] = Array.isArray(attachments)
    ? (attachments as AttachmentRow[])
    : [];

  const statusKey = (job.status ?? 'pending') as string;
  const statusUi = JOB_STATUS_DISPLAY[statusKey as JobStatusUi];
  const completionNotes = (job.completion_notes as string | null)?.trim();
  const reference = (job.reference_number as string) || job.id.slice(0, 8);
  const scheduledLabel = formatScheduledDateTime(
    job.scheduled_date as string | null,
    job.scheduled_time as string | null
  );
  const hasSchedule = Boolean(job.scheduled_date || job.scheduled_time);

  return (
    <div className="flex flex-col gap-5">
      <PortalJobsBackLink />

      <PageGradientHeader
        eyebrow="Job"
        title={reference}
        subtitle={hasSchedule ? scheduledLabel : undefined}
        actions={<Tag tone={STATUS_TONE[statusKey] ?? 'slate'}>{statusUi?.label ?? job.status ?? 'Unknown'}</Tag>}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <LookCard title="Job details" icon={FileText} tone="rounds">
          <Field label="Address">
            <p className="font-medium">{job.address || '—'}</p>
          </Field>
          <Field label="Scheduled">
            <p className="font-medium">{hasSchedule ? scheduledLabel : '—'}</p>
          </Field>
          <Field label="Description">
            <p className="whitespace-pre-wrap">{job.job_description || '—'}</p>
          </Field>
          {completionNotes ? (
            <Field label="Completion notes">
              <p className="whitespace-pre-wrap">{completionNotes}</p>
            </Field>
          ) : null}
        </LookCard>

        <div className="flex flex-col gap-5">
          <LookCard title="Status" icon={History} tone="sky">
            {historyRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No status changes yet.</p>
            ) : (
              <ol className="flex flex-col gap-4">
                {historyRows.map((entry) => {
                  const tone = STATUS_TONE[entry.to_status] ?? 'slate';
                  const line =
                    entry.from_status != null
                      ? `${statusLabel(entry.from_status)} → ${statusLabel(entry.to_status)}`
                      : statusLabel(entry.to_status);
                  return (
                    <li key={entry.id} className="flex gap-3">
                      <span
                        className={cn('mt-1.5 size-2 shrink-0 rounded-full', toneClasses(tone).solid)}
                        aria-hidden
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{line}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{formatWhen(entry.created_at)}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </LookCard>

          <LookCard title="Attachments" icon={Paperclip} tone="slate" aside={attachmentRows.length || undefined}>
            {attachmentRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No files on this job.</p>
            ) : (
              <ul className="divide-y divide-border">
                {attachmentRows.map((file) => (
                  <li key={file.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className="truncate text-sm font-medium">{file.file_name}</span>
                    <a
                      href={file.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-sm font-medium text-primary hover:underline"
                    >
                      View
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </LookCard>
        </div>
      </div>
    </div>
  );
}
