'use client';

import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { JobStatus, JobPriority } from '@/lib/data/jobs';
import { JobDetailDeleteButton } from '@/components/jobs/job-detail-delete-button';

const STATUS_LABELS: Record<JobStatus, string> = {
  pending: 'Pending',
  pending_send: 'Ready to send',
  assigned: 'Assigned',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const STATUS_BADGE_CLASS: Record<JobStatus, string> = {
  pending:
    'border-amber-400/60 bg-amber-500/10 text-amber-700 dark:text-amber-400 shadow-[0_0_12px_-2px_rgba(245,158,11,0.25)]',
  pending_send:
    'border-cyan-400/60 bg-cyan-500/10 text-cyan-800 dark:text-cyan-300 shadow-[0_0_12px_-2px_rgba(6,182,212,0.25)]',
  assigned:
    'border-blue-400/60 bg-blue-500/10 text-blue-700 dark:text-blue-400 shadow-[0_0_12px_-2px_rgba(59,130,246,0.25)]',
  in_progress:
    'border-violet-400/60 bg-violet-500/10 text-violet-700 dark:text-violet-400 shadow-[0_0_12px_-2px_rgba(139,92,246,0.25)]',
  completed:
    'border-emerald-400/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 shadow-[0_0_12px_-2px_rgba(16,185,129,0.25)]',
  cancelled:
    'border-red-300/50 bg-red-500/5 text-red-600 dark:text-red-400/90 shadow-[0_0_8px_-2px_rgba(239,68,68,0.2)]',
};

const PRIORITY_LABELS: Record<JobPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

const PRIORITY_BADGE_CLASS: Record<JobPriority, string> = {
  low: 'border-slate-400/40 bg-slate-500/10 text-slate-600 dark:text-slate-400',
  normal: 'border-sky-400/40 bg-sky-500/10 text-sky-700 dark:text-sky-400',
  high: 'border-orange-400/50 bg-orange-500/10 text-orange-700 dark:text-orange-400',
  urgent:
    'border-rose-400/60 bg-rose-500/10 text-rose-700 dark:text-rose-400 shadow-[0_0_10px_-2px_rgba(244,63,94,0.2)]',
};

interface JobDetailHeaderProps {
  jobId: string;
  referenceNumber: string;
  status: JobStatus;
  priority: JobPriority;
  createdAt: string;
}

export function JobDetailHeader({
  jobId,
  referenceNumber,
  status,
  priority,
  createdAt,
}: JobDetailHeaderProps) {
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
        <Link href="/jobs" className="gap-2">
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
              'inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium backdrop-blur-sm transition-shadow',
              STATUS_BADGE_CLASS[status]
            )}
          >
            {STATUS_LABELS[status]}
          </span>
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium backdrop-blur-sm',
              PRIORITY_BADGE_CLASS[priority]
            )}
          >
            {PRIORITY_LABELS[priority]}
          </span>
          {createdRelative && (
            <span className="text-sm text-muted-foreground">
              Created {createdRelative}
            </span>
          )}
        </div>
        <JobDetailDeleteButton jobId={jobId} status={status} />
      </div>
    </div>
  );
}
