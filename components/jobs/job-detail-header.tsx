'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { JobStatus, JobPriority } from '@/lib/data/jobs';
import type { JobLength } from '@/lib/jobs/normalize-job-length';
import { getRememberedJobsListHref } from '@/lib/jobs/jobs-list-query';
import { JOB_STATUS_DISPLAY } from '@/lib/job-status-display';
import { JobDetailDeleteButton } from '@/components/jobs/job-detail-delete-button';

const PRIORITY_LABELS: Record<JobPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  emergency: 'Urgent',
};

const PRIORITY_BADGE_CLASS: Record<JobPriority, string> = {
  low: 'border-slate-300/65 bg-gradient-to-br from-slate-100/90 to-slate-50/70 text-slate-700 backdrop-blur-sm dark:border-slate-600/40 dark:from-slate-800/45 dark:to-slate-900/30 dark:text-slate-300',
  normal:
    'border-sky-300/65 bg-gradient-to-br from-sky-100/90 to-blue-50/70 text-sky-900 backdrop-blur-sm dark:border-sky-700/40 dark:from-sky-950/40 dark:to-blue-950/25 dark:text-sky-200',
  high: 'border-amber-300/65 bg-gradient-to-br from-amber-100/90 to-orange-50/70 text-amber-950 backdrop-blur-sm dark:border-amber-700/40 dark:from-amber-950/40 dark:to-orange-950/20 dark:text-amber-200',
  emergency:
    'border-rose-300/65 bg-gradient-to-br from-rose-100/90 to-red-50/70 text-rose-950 backdrop-blur-sm dark:border-rose-700/40 dark:from-rose-950/40 dark:to-red-950/20 dark:text-rose-200',
};

const JOB_LENGTH_LABELS: Record<JobLength, string> = {
  half_day: 'Half day',
  full_day: 'Full day',
};

const JOB_LENGTH_BADGE_CLASS: Record<JobLength, string> = {
  half_day:
    'border-teal-300/65 bg-gradient-to-br from-teal-100/90 to-cyan-50/70 text-teal-900 backdrop-blur-sm dark:border-teal-700/40 dark:from-teal-950/40 dark:to-cyan-950/20 dark:text-teal-200',
  full_day:
    'border-indigo-300/65 bg-gradient-to-br from-indigo-100/90 to-violet-50/70 text-indigo-900 backdrop-blur-sm dark:border-indigo-700/40 dark:from-indigo-950/40 dark:to-violet-950/20 dark:text-indigo-200',
};

interface JobDetailHeaderProps {
  jobId: string;
  referenceNumber: string;
  status: JobStatus;
  priority: JobPriority;
  jobLength?: JobLength | null;
  createdAt: string;
  hideDeleteAction?: boolean;
}

export function JobDetailHeader({
  jobId,
  referenceNumber,
  status,
  priority,
  jobLength,
  createdAt,
  hideDeleteAction = false,
}: JobDetailHeaderProps) {
  const router = useRouter();

  const createdRelative = (() => {
    try {
      return formatDistanceToNow(new Date(createdAt), { addSuffix: true });
    } catch {
      return '';
    }
  })();

  return (
    <div className="flex flex-col gap-4">
      <Button
        variant="ghost"
        size="sm"
        className="w-fit -ml-2 text-muted-foreground hover:text-foreground"
        asChild
      >
        <Link
          href="/jobs"
          className="gap-2"
          onClick={(e) => {
            e.preventDefault();
            router.push(getRememberedJobsListHref());
          }}
        >
          <ArrowLeft className="size-4" />
          Back to Jobs
        </Link>
      </Button>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-3 sm:gap-4">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {referenceNumber}
          </h1>
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-shadow',
              JOB_STATUS_DISPLAY[status]?.badgeClass
            )}
          >
            {JOB_STATUS_DISPLAY[status]?.label ?? status}
          </span>
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium backdrop-blur-sm',
              PRIORITY_BADGE_CLASS[priority]
            )}
          >
            {PRIORITY_LABELS[priority]}
          </span>
          {jobLength && (
            <span
              className={cn(
                'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium backdrop-blur-sm',
                JOB_LENGTH_BADGE_CLASS[jobLength]
              )}
            >
              {JOB_LENGTH_LABELS[jobLength]}
            </span>
          )}
          {createdRelative && (
            <span className="text-sm text-muted-foreground">
              Created {createdRelative}
            </span>
          )}
        </div>
        {!hideDeleteAction && <JobDetailDeleteButton jobId={jobId} status={status} />}
      </div>
    </div>
  );
}
