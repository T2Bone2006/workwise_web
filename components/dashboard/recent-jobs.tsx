import Link from 'next/link';
import { format, parseISO, isValid } from 'date-fns';
import type { RecentJobItem } from '@/lib/data/dashboard';
import { JOB_STATUS_DISPLAY, type JobStatusUi } from '@/lib/job-status-display';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function statusMeta(s: string | null) {
  if (!s) return { label: '—' as string, className: 'bg-muted text-muted-foreground' };
  const ui = JOB_STATUS_DISPLAY[s as JobStatusUi];
  if (ui) return { label: ui.label, className: ui.badgeClass };
  return { label: s, className: 'bg-muted text-muted-foreground' };
}

function formatScheduled(value: string | null) {
  if (!value) return '—';
  try {
    const d = parseISO(value.length <= 10 ? `${value}T12:00:00` : value);
    if (!isValid(d)) return value;
    return format(d, 'd MMM yyyy');
  } catch {
    return value;
  }
}

const RECENT_JOBS_MAX_ROWS = 8;

export function RecentJobs({
  jobs,
  emptyMessage = 'No jobs yet',
}: {
  jobs: RecentJobItem[];
  emptyMessage?: string;
}) {
  const rows = jobs.slice(0, RECENT_JOBS_MAX_ROWS);

  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4 dark:border-white/[0.06]">
      <div className="mb-4 flex shrink-0 items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Recent jobs</h3>
        <Link href="/jobs" className="text-xs font-medium text-primary hover:underline">
          View all jobs
        </Link>
      </div>
      {rows.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
          <Link
            href="/jobs/new"
            className="mt-3 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Create your first job
          </Link>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="border-[var(--glass-border)] hover:bg-transparent">
              <TableHead className="text-muted-foreground">Ref</TableHead>
              <TableHead className="text-muted-foreground">Address</TableHead>
              <TableHead className="text-muted-foreground">Worker</TableHead>
              <TableHead className="text-muted-foreground">Status</TableHead>
              <TableHead className="text-right text-muted-foreground">Scheduled</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((job) => (
              <TableRow
                key={job.id}
                className="border-[var(--glass-border)] hover:bg-muted/40"
              >
                <TableCell className="font-medium">
                  <Link href={`/jobs/${job.id}`} className="text-primary hover:underline">
                    #{job.reference_number ?? job.id.slice(0, 8)}
                  </Link>
                </TableCell>
                <TableCell className="max-w-[200px] truncate text-muted-foreground" title={job.address ?? undefined}>
                  {job.address?.trim() || '—'}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {job.worker_name?.trim() ? job.worker_name : (
                    <span className="italic opacity-80">Unassigned</span>
                  )}
                </TableCell>
                <TableCell>
                  {(() => {
                    const { label, className } = statusMeta(job.status);
                    return (
                      <span
                        className={cn(
                          'inline-flex rounded-full border px-2 py-0.5 text-xs font-medium',
                          className
                        )}
                      >
                        {label}
                      </span>
                    );
                  })()}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {formatScheduled(job.scheduled_date)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
