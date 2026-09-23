import { format, parseISO, isValid } from 'date-fns';
import { FileText, MapPin } from 'lucide-react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { JobStatusTimeline } from '@/components/jobs/job-status-timeline';
import { PortalJobsBackLink } from '@/components/portal/portal-jobs-back-link';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
    redirect('/portal/login');
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
      <div className="space-y-5">
        <PageGradientHeader title="Job not found" subtitle="You do not have access to this job." />
        <PortalJobsBackLink />
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
      <div className="space-y-5">
        <PageGradientHeader title="Job not found" subtitle="This job does not exist or you do not have permission to view it." />
        <PortalJobsBackLink />
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

  const statusKey = (job.status ?? 'pending') as JobStatusUi;
  const statusUi = JOB_STATUS_DISPLAY[statusKey];
  const completionNotes = (job.completion_notes as string | null)?.trim();
  const reference = (job.reference_number as string) || job.id.slice(0, 8);

  const timelineEntries = historyRows.map((entry) => ({
    id: entry.id,
    to_status: entry.to_status,
    from_status: entry.from_status,
    created_at: entry.created_at,
    changed_by_user_id: null,
    changed_by_worker_id: null,
    notes: null,
    metadata: null,
  }));

  return (
    <div className="space-y-5">
      <PortalJobsBackLink />

      <PageGradientHeader
        eyebrow="Job"
        title={reference}
        subtitle={formatScheduledDateTime(
          job.scheduled_date as string | null,
          job.scheduled_time as string | null
        )}
        actions={
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium',
              statusUi?.badgeClass ?? 'border-slate-300/65 bg-slate-100/90 text-slate-800'
            )}
          >
            {statusUi?.label ?? job.status ?? 'Unknown'}
          </span>
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="overflow-hidden border border-border/80 bg-card shadow-sm dark:border-white/[0.08]">
          <CardHeader className="pb-2">
            <h2 className="text-base font-semibold text-foreground">Job details</h2>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex gap-2.5">
              <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-muted-foreground">Address</p>
                <p className="mt-1 font-medium text-foreground">{job.address || '—'}</p>
              </div>
            </div>
            <div>
              <p className="text-muted-foreground">Scheduled</p>
              <p className="mt-1 font-medium text-foreground">
                {formatScheduledDateTime(
                  job.scheduled_date as string | null,
                  job.scheduled_time as string | null
                )}
              </p>
            </div>
            <div className="flex gap-2.5">
              <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-muted-foreground">Description</p>
                <p className="mt-1 whitespace-pre-wrap text-foreground">
                  {job.job_description || '—'}
                </p>
              </div>
            </div>
            {completionNotes ? (
              <div>
                <p className="text-muted-foreground">Completion notes</p>
                <p className="mt-1 whitespace-pre-wrap text-foreground">{completionNotes}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <JobStatusTimeline entries={timelineEntries} showActor={false} />

          <Card className="overflow-hidden border border-border/80 bg-card shadow-sm dark:border-white/[0.08]">
            <CardHeader className="pb-2">
              <h2 className="text-base font-semibold text-foreground">Attachments</h2>
            </CardHeader>
            <CardContent>
              {attachmentRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No attachments</p>
              ) : (
                <ul className="space-y-3">
                  {attachmentRows.map((file) => (
                    <li
                      key={file.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 text-sm"
                    >
                      <span className="truncate font-medium text-foreground">{file.file_name}</span>
                      <a
                        href={file.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-primary hover:underline"
                      >
                        View
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
