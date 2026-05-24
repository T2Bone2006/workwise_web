import Link from 'next/link';
import { format, parseISO, isValid } from 'date-fns';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
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

function statusLabel(status: string | null): string {
  if (!status) return '—';
  const key = status as JobStatusUi;
  return JOB_STATUS_DISPLAY[key]?.label ?? status.replace(/_/g, ' ');
}

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

function formatHistoryTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return format(date, "d MMM yyyy 'at' HH:mm");
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
      <div className="flex flex-col items-center justify-center rounded-xl border border-border/80 bg-muted/20 px-6 py-16 text-center">
        <h1 className="text-lg font-semibold text-foreground">Job not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This job does not exist or you do not have permission to view it.
        </p>
        <Link href="/portal" className="mt-4 text-sm text-primary hover:underline">
          ← Back to all jobs
        </Link>
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
      <div className="flex flex-col items-center justify-center rounded-xl border border-border/80 bg-muted/20 px-6 py-16 text-center">
        <h1 className="text-lg font-semibold text-foreground">Job not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This job does not exist or you do not have permission to view it.
        </p>
        <Link href="/portal" className="mt-4 text-sm text-primary hover:underline">
          ← Back to all jobs
        </Link>
      </div>
    );
  }

  const [{ data: statusHistory }, { data: attachments }] = await Promise.all([
    supabase
      .from('job_status_history')
      .select('id, from_status, to_status, created_at')
      .eq('job_id', jobId)
      .order('created_at', { ascending: true }),
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

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link
          href="/portal"
          className="inline-flex text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to all jobs
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {job.reference_number || job.id.slice(0, 8)}
        </h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="glass-card border-border/80 shadow-[var(--shadow-glass-value)]">
          <CardHeader className="pb-2">
            <h2 className="text-base font-semibold text-foreground">Job details</h2>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="text-muted-foreground">Address</p>
              <p className="mt-1 font-medium text-foreground">{job.address || '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Status</p>
              <p className="mt-1">
                <span
                  className={cn(
                    'inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium backdrop-blur-sm',
                    statusUi?.badgeClass ??
                      'border-slate-400/60 bg-slate-500/10 text-slate-800 dark:text-slate-200'
                  )}
                >
                  {statusUi?.label ?? job.status ?? 'Unknown'}
                </span>
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Scheduled date and time</p>
              <p className="mt-1 font-medium text-foreground">
                {formatScheduledDateTime(
                  job.scheduled_date as string | null,
                  job.scheduled_time as string | null
                )}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Description</p>
              <p className="mt-1 whitespace-pre-wrap text-foreground">
                {job.job_description || '—'}
              </p>
            </div>
            {completionNotes ? (
              <div>
                <p className="text-muted-foreground">Completion notes</p>
                <p className="mt-1 whitespace-pre-wrap text-foreground">{completionNotes}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="glass-card border-border/80 shadow-[var(--shadow-glass-value)]">
            <CardHeader className="pb-2">
              <h2 className="text-base font-semibold text-foreground">Status timeline</h2>
            </CardHeader>
            <CardContent>
              {historyRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No status updates yet</p>
              ) : (
                <ul className="space-y-4">
                  {historyRows.map((entry) => {
                    const fromLabel = entry.from_status
                      ? statusLabel(entry.from_status)
                      : null;
                    const toLabel = statusLabel(entry.to_status);
                    const transition = fromLabel ? `${fromLabel} → ${toLabel}` : toLabel;
                    return (
                      <li
                        key={entry.id}
                        className="border-l-2 border-border/80 pl-4 text-sm"
                      >
                        <p className="font-medium text-foreground">
                          {transition}
                          <span className="font-normal text-muted-foreground">
                            {' '}
                            · {formatHistoryTimestamp(entry.created_at)}
                          </span>
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="glass-card border-border/80 shadow-[var(--shadow-glass-value)]">
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
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="truncate font-medium text-foreground">
                        {file.file_name}
                      </span>
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
