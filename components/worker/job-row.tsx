import Link from 'next/link';
import { format, parseISO } from 'date-fns';
import { MapPin, User } from 'lucide-react';
import { Tag } from '@/components/look';
import { toLookTone } from '@/components/worker/tone';
import { cn } from '@/lib/utils';
import { isUrgent, workerTag } from '@/lib/worker/status';
import type { WorkerJob } from '@/lib/worker/types';

/** "Tue 14 Oct" for a job's day, or "No date" when it has none. */
export function jobDayLabel(date: string | null): string {
  return date ? format(parseISO(date), 'EEE d MMM') : 'No date';
}

/**
 * One job as a row: when, what, where, and where it is up to. Used on the Dashboard, the
 * Calendar day list and the Jobs lists. `lead` chooses what the left column shows:
 * the time (a day's timeline) or the day (a list across days).
 */
export function JobRow({
  job,
  lead = 'time',
  href,
  reason,
  className,
}: {
  job: WorkerJob;
  lead?: 'time' | 'day';
  /** Where the row goes; defaults to the job page. */
  href?: string;
  /** A line under the title, e.g. why a job was not completed. */
  reason?: string | null;
  className?: string;
}) {
  const tag = workerTag(job);
  const urgent = isUrgent(job);
  const where = [job.address, job.postcode].filter(Boolean).join(', ');
  const finished = job.status === 'completed' || job.status === 'incomplete' || job.status === 'declined';

  return (
    <Link
      href={href ?? `/worker/jobs/${job.id}`}
      className={cn(
        'group grid grid-cols-[4.25rem_1fr] items-start gap-3 rounded-xl border border-border bg-card px-3 py-3 transition-colors sm:grid-cols-[5rem_1fr_auto] sm:px-4',
        'hover:border-(--tone-rounds-solid)/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        finished && 'opacity-80',
        className,
      )}
    >
      <div className="leading-tight">
        {lead === 'time' ? (
          <p className="text-base font-semibold tabular-nums">{job.scheduledTime ?? 'Any time'}</p>
        ) : (
          <>
            <p className="text-sm font-semibold">{jobDayLabel(job.scheduledDate)}</p>
            {job.scheduledTime ? <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{job.scheduledTime}</p> : null}
          </>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-[15px] font-medium">{job.title}</p>
        {where ? (
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{where}</span>
          </p>
        ) : null}
        {job.customerName ? (
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-muted-foreground">
            <User className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{job.customerName}</span>
          </p>
        ) : null}
        {reason ? <p className="mt-1 text-sm text-(--tone-amber-text)">Not completed: {reason}</p> : null}
        <div className="mt-2 flex flex-wrap gap-1.5 sm:hidden">
          {urgent ? <Tag tone="rose">Urgent</Tag> : null}
          {tag ? <Tag tone={toLookTone(tag.tone)}>{tag.label}</Tag> : null}
        </div>
      </div>
      <div className="hidden flex-col items-end gap-1.5 sm:flex">
        {urgent ? <Tag tone="rose">Urgent</Tag> : null}
        {tag ? <Tag tone={toLookTone(tag.tone)}>{tag.label}</Tag> : null}
      </div>
    </Link>
  );
}
