import Link from 'next/link';
import { format, parseISO } from 'date-fns';
import { MapPin, User } from 'lucide-react';
import { Tag } from '@/components/look';
import { JobResponse } from '@/components/worker/job-response';
import { isUrgent } from '@/lib/worker/status';
import type { WorkerJob } from '@/lib/worker/types';

/** The day as a small tile: weekday, number, month, then the time. A job with no day says so. */
function DayTile({ date, time }: { date: string | null; time: string | null }) {
  return (
    <div className="flex w-16 shrink-0 flex-col items-center justify-center rounded-xl bg-(--tone-sky-soft) px-1 py-2 text-center text-(--tone-sky-text) sm:w-[4.5rem]">
      {date ? (
        <>
          <span className="text-xs font-medium">{format(parseISO(date), 'EEE')}</span>
          <span className="text-2xl leading-none font-semibold tabular-nums">{format(parseISO(date), 'd')}</span>
          <span className="text-xs font-medium">{format(parseISO(date), 'MMM')}</span>
        </>
      ) : (
        <span className="text-xs font-medium">No day set</span>
      )}
      <span className="mt-1 text-xs font-semibold tabular-nums">{time ?? 'Any time'}</span>
    </div>
  );
}

/** One job waiting for the worker's answer, with Accept and Decline on it. */
export function OfferCard({ job, employerName }: { job: WorkerJob; employerName: string | null }) {
  const where = [job.address, job.postcode].filter(Boolean).join(', ');
  return (
    <article className="flex gap-3.5 rounded-2xl border border-(--tone-sky-line) bg-card p-3.5 shadow-(--look-card-shadow) sm:gap-4 sm:p-4">
      <DayTile date={job.scheduledDate} time={job.scheduledTime} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {isUrgent(job) ? <Tag tone="rose">Urgent</Tag> : null}
          {job.referenceNumber ? <span className="text-xs text-muted-foreground tabular-nums">{job.referenceNumber}</span> : null}
        </div>
        <h3 className="mt-0.5 text-[16px] leading-snug font-semibold tracking-tight break-words">
          <Link
            href={`/worker/jobs/${job.id}`}
            className="underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {job.title}
          </Link>
        </h3>
        <div className="mt-1 space-y-0.5 text-sm text-muted-foreground">
          {where ? (
            <p className="flex items-center gap-1.5">
              <MapPin className="size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 truncate">{where}</span>
            </p>
          ) : null}
          {job.customerName ? (
            <p className="flex items-center gap-1.5">
              <User className="size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 truncate">{job.customerName}</span>
            </p>
          ) : null}
        </div>
        <JobResponse jobId={job.id} jobTitle={job.title} employerName={employerName} className="mt-3" />
      </div>
    </article>
  );
}

/** Every job waiting for an answer, most pressing first. Nothing at all when there are none. */
export function OffersSection({
  jobs,
  employerName,
  limit,
}: {
  jobs: readonly WorkerJob[];
  employerName: string | null;
  /** Show only this many, with a link to the rest on the Jobs page. */
  limit?: number;
}) {
  if (jobs.length === 0) return null;
  const shown = limit ? jobs.slice(0, limit) : jobs;
  const hidden = jobs.length - shown.length;
  return (
    <section aria-label="Jobs waiting for your answer" className="space-y-2.5">
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-semibold">{jobs.length === 1 ? 'A new job is waiting for you' : 'New jobs are waiting for you'}</h2>
        <Tag tone="sky">{jobs.length}</Tag>
      </div>
      <ul className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
        {shown.map((job) => (
          <li key={job.id} className="min-w-0">
            <OfferCard job={job} employerName={employerName} />
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <Link href="/worker/jobs" className="inline-block text-sm font-medium text-(--tone-sky-text) underline-offset-4 hover:underline">
          See the other {hidden} waiting
        </Link>
      ) : null}
    </section>
  );
}
