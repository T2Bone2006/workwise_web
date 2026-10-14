import Link from 'next/link';
import { format, parseISO } from 'date-fns';
import { ArrowRight, CalendarCheck, CircleCheck } from 'lucide-react';
import { EmptyState, LookCard } from '@/components/look';
import { JobRow, jobDayLabel } from '@/components/worker/job-row';
import { formatGbp } from '@/lib/money/pence';
import { cn } from '@/lib/utils';
import type { DayPlan } from '@/lib/worker/day-plan';

/** A ring that fills as the day's jobs are finished. Finished = done or reported as not completed. */
function ProgressRing({ finished, total }: { finished: number; total: number }) {
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const fraction = total > 0 ? Math.min(1, finished / total) : 0;
  return (
    <div className="relative size-[76px] shrink-0" role="img" aria-label={`${finished} of ${total} jobs finished`}>
      <svg viewBox="0 0 76 76" className="size-full -rotate-90">
        <circle cx="38" cy="38" r={radius} fill="none" strokeWidth="8" className="stroke-muted" />
        <circle
          cx="38"
          cy="38"
          r={radius}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          className="stroke-(--tone-emerald-solid) transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-xl font-semibold tabular-nums">{finished}</span>
        <span className="mt-0.5 text-[11px] text-muted-foreground">of {total}</span>
      </div>
    </div>
  );
}

/**
 * Today at a glance: how far through the day you are, what is next, and the day's jobs in
 * order. Reading only: accepting and finishing jobs happen in the phone app.
 */
export function DayCard({
  plan,
  today,
  nextJobDate,
}: {
  plan: DayPlan;
  today: string;
  /** The day of the next job after today, for the empty state. */
  nextJobDate: string | null;
}) {
  const finished = plan.done + plan.notCompleted;
  const heading = format(parseISO(today), 'EEEE d MMMM');

  if (plan.total === 0) {
    return (
      <LookCard title="Today" icon={CalendarCheck} tone="sky" aside={heading}>
        <EmptyState
          icon={CircleCheck}
          title="Nothing on today"
          body={nextJobDate ? `Your next job is ${jobDayLabel(nextJobDate)}.` : 'When your manager gives you a job it will show here.'}
          action={
            nextJobDate ? (
              <Link
                href={`/worker/calendar?date=${nextJobDate}`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-(--tone-rounds-text) underline-offset-4 hover:underline"
              >
                See it in the calendar <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            ) : null
          }
        />
      </LookCard>
    );
  }

  const allDone = plan.remaining === 0;
  // Rounds only: what the day adds up to. Skipped visits aren't counted.
  const rounds = plan.jobs.some((j) => j.rounds);
  const dayTotal = plan.jobs.reduce((sum, j) => sum + (j.status === 'cancelled' ? 0 : (j.price ?? 0)), 0);
  return (
    <LookCard title="Today" icon={CalendarCheck} tone="sky" aside={heading}>
      <div className="flex items-center gap-4">
        <ProgressRing finished={finished} total={plan.total} />
        <div className="min-w-0">
          <p className="text-lg font-semibold tracking-tight">
            {allDone
              ? 'All done for today'
              : `${plan.remaining} ${plan.remaining === 1 ? (rounds ? 'stop' : 'job') : rounds ? 'stops' : 'jobs'} to go`}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {plan.done} done
            {plan.notCompleted > 0 ? ` · ${plan.notCompleted} not completed` : ''}
            {plan.underway > 0 ? ` · ${plan.underway} under way` : ''}
            {plan.waiting > 0 ? ` · ${plan.waiting} waiting for you` : ''}
          </p>
          {rounds ? (
            <p className="mt-1 text-sm font-medium tabular-nums">
              {plan.total} {plan.total === 1 ? 'stop' : 'stops'} · {formatGbp(dayTotal)}
            </p>
          ) : null}
          {plan.next ? (
            <p className="mt-1.5 truncate text-sm">
              <span className="font-medium text-(--tone-rounds-text)">Next:</span>{' '}
              <span className="tabular-nums">{plan.next.scheduledTime ?? 'any time'}</span> {plan.next.title}
              {plan.next.postcode ? `, ${plan.next.postcode}` : ''}
            </p>
          ) : null}
        </div>
      </div>

      <ol className="mt-4 space-y-2" aria-label="Today's jobs">
        {plan.jobs.map((job) => (
          <li key={job.id} className={cn(plan.next?.id === job.id && 'rounded-xl ring-2 ring-(--tone-rounds-solid)/40')}>
            <JobRow job={job} />
          </li>
        ))}
      </ol>
    </LookCard>
  );
}
