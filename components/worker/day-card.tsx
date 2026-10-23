import Link from 'next/link';
import { ArrowRight, CalendarCheck, CircleCheck, MapPin, Navigation, Phone, User } from 'lucide-react';
import { IconChip, LookCard, Tag } from '@/components/look';
import { JobRow, jobDayLabel } from '@/components/worker/job-row';
import { PhoneNote } from '@/components/worker/phone-note';
import { toLookTone } from '@/components/worker/tone';
import { Button } from '@/components/ui/button';
import { formatGbp } from '@/lib/money/pence';
import { cn } from '@/lib/utils';
import type { DayPlan } from '@/lib/worker/day-plan';
import { directionsHref, telHref } from '@/lib/worker/field-link';
import { FINISHED_STATUSES, UNDERWAY_STATUSES, isUrgent, workerTag } from '@/lib/worker/status';
import type { WorkerJob, WorkerJobDetail } from '@/lib/worker/types';

/** A job the worker has not answered yet: it is shown in "waiting for you", not in the day. */
const isWaiting = (job: WorkerJob) => job.status === 'assigned' && !job.rounds;

/** One segment per job, coloured by where it is up to. */
function DayBar({ jobs }: { jobs: readonly WorkerJob[] }) {
  return (
    <div className="flex gap-1" role="img" aria-label={`${jobs.filter((j) => FINISHED_STATUSES.has(j.status)).length} of ${jobs.length} jobs finished`}>
      {jobs.map((job) => (
        <span
          key={job.id}
          className={cn(
            'h-1.5 min-w-3 flex-1 rounded-full',
            job.status === 'completed'
              ? 'bg-(--tone-emerald-solid)'
              : job.status === 'incomplete'
                ? 'bg-(--tone-amber-solid)'
                : UNDERWAY_STATUSES.has(job.status)
                  ? 'bg-(--tone-rounds-solid)'
                  : 'bg-muted',
          )}
        />
      ))}
    </div>
  );
}

/** The job to do next, big enough to read at arm's length: when, what, where, and one tap to get there or ring. */
function UpNext({ job, detail }: { job: WorkerJob; detail: WorkerJobDetail | null }) {
  const tag = workerTag(job);
  const where = [job.address, job.postcode].filter(Boolean).join(', ');
  const maps = directionsHref(job.address, job.postcode);
  const tel = telHref(detail?.customerPhone);
  const underway = UNDERWAY_STATUSES.has(job.status);
  return (
    <div className="rounded-2xl border border-(--tone-rounds-line) bg-(--tone-rounds-soft) p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-(--tone-rounds-text)">{underway ? 'Under way' : 'Up next'}</span>
        {isUrgent(job) ? <Tag tone="rose">Urgent</Tag> : null}
        {tag && !underway ? <Tag tone={toLookTone(tag.tone)}>{tag.label}</Tag> : null}
      </div>
      <div className="mt-2 flex items-start gap-4">
        <p className="shrink-0 text-3xl leading-none font-semibold tracking-tight tabular-nums">{job.scheduledTime ?? 'Any time'}</p>
        <div className="min-w-0">
          <p className="text-[17px] leading-snug font-semibold">
            <Link href={`/worker/jobs/${job.id}`} className="underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
              {job.title}
            </Link>
          </p>
          {where ? (
            <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
              <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{where}</span>
            </p>
          ) : null}
          {job.customerName ? (
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
              <User className="size-3.5 shrink-0" aria-hidden />
              <span>{job.customerName}</span>
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {maps ? (
          <Button asChild variant="outline" className="h-10 bg-card">
            <a href={maps} target="_blank" rel="noopener noreferrer">
              <Navigation /> Directions
            </a>
          </Button>
        ) : null}
        {tel ? (
          <Button asChild variant="outline" className="h-10 bg-card">
            <a href={tel}>
              <Phone /> Call {detail?.customerName ? detail.customerName.split(' ')[0] : 'customer'}
            </a>
          </Button>
        ) : null}
        <Button asChild variant="ghost" className="h-10">
          <Link href={`/worker/jobs/${job.id}`}>
            Open job <ArrowRight />
          </Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * Today: how the day is going, the job to do next, and the rest of the day in order. Jobs still waiting for an
 * answer are not part of the day yet, so they are left out of it and shown above, with Accept and Decline.
 */
export function DayCard({
  plan,
  nextJobDate,
  nextDetail = null,
  waitingToday = 0,
}: {
  plan: DayPlan;
  /** The day of the next job after today, for the empty state. */
  nextJobDate: string | null;
  /** The next job in full (customer phone), when there is one. */
  nextDetail?: WorkerJobDetail | null;
  /** How many of today's jobs are still waiting for an answer. */
  waitingToday?: number;
}) {
  const jobs = plan.jobs.filter((j) => !isWaiting(j));
  const finished = jobs.filter((j) => FINISHED_STATUSES.has(j.status)).length;
  const remaining = jobs.length - finished;
  const next = plan.next && !isWaiting(plan.next) ? plan.next : null;
  const rest = jobs.filter((j) => j.id !== next?.id);

  if (jobs.length === 0) {
    return (
      <LookCard title="Today" icon={CalendarCheck} tone="sky">
        <div className="flex items-start gap-3 py-1">
          <IconChip icon={CircleCheck} tone="emerald" />
          <div className="min-w-0">
            <p className="text-[15px] font-semibold">Nothing to do today</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {waitingToday > 0
                ? `${waitingToday === 1 ? 'A job' : `${waitingToday} jobs`} on today ${waitingToday === 1 ? 'is' : 'are'} waiting for your answer above.`
                : nextJobDate
                  ? `Your next job is ${jobDayLabel(nextJobDate)}.`
                  : 'When your manager gives you a job it will show here.'}
            </p>
            {nextJobDate && waitingToday === 0 ? (
              <Link
                href={`/worker/calendar?date=${nextJobDate}`}
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-(--tone-rounds-text) underline-offset-4 hover:underline"
              >
                See it in the calendar <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            ) : null}
          </div>
        </div>
      </LookCard>
    );
  }

  const rounds = jobs.some((j) => j.rounds);
  const dayTotal = jobs.reduce((sum, j) => sum + (j.status === 'cancelled' ? 0 : (j.price ?? 0)), 0);
  const unit = rounds ? (remaining === 1 ? 'stop' : 'stops') : remaining === 1 ? 'job' : 'jobs';
  return (
    <LookCard
      title="Today"
      icon={CalendarCheck}
      tone="sky"
      aside={remaining === 0 ? 'All done' : `${remaining} ${unit} to go`}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <DayBar jobs={jobs} />
          <p className="text-sm text-muted-foreground">
            {finished} of {jobs.length} finished
            {rounds ? ` · ${formatGbp(dayTotal)} today` : ''}
            {waitingToday > 0 ? ` · ${waitingToday} more waiting for your answer` : ''}
          </p>
        </div>

        {next ? <UpNext job={next} detail={nextDetail} /> : null}

        {rest.length > 0 ? (
          <ol className="space-y-2" aria-label={next ? 'The rest of today' : "Today's jobs"}>
            {rest.map((job) => (
              <li key={job.id}>
                <JobRow job={job} />
              </li>
            ))}
          </ol>
        ) : null}

        {remaining > 0 && !rounds ? <PhoneNote variant="line">Start and finish jobs in the WorkWise app.</PhoneNote> : null}
      </div>
    </LookCard>
  );
}
