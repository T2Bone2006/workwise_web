import { format, parseISO } from 'date-fns';
import { CalendarOff } from 'lucide-react';
import { EmptyState } from '@/components/look';
import { JobRow } from '@/components/worker/job-row';
import { planDay } from '@/lib/worker/day-plan';
import type { WorkerJob } from '@/lib/worker/types';

/** One day's jobs in time order, under a heading that says how many. */
export function WorkerDayList({ jobs, date, today }: { jobs: readonly WorkerJob[]; date: string; today: string }) {
  const plan = planDay(jobs, date);
  const heading = date === today ? 'Today' : format(parseISO(date), 'EEEE d MMMM');
  return (
    <section aria-label={`Jobs on ${format(parseISO(date), 'EEEE d MMMM')}`} className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold">
          {heading}
          {date === today ? <span className="ml-2 font-normal text-muted-foreground">{format(parseISO(date), 'EEEE d MMMM')}</span> : null}
        </h2>
        <p className="text-sm text-muted-foreground">
          {plan.total === 0 ? 'No jobs' : `${plan.total} ${plan.total === 1 ? 'job' : 'jobs'}`}
        </p>
      </div>
      {plan.total === 0 ? (
        <EmptyState icon={CalendarOff} title="Nothing on this day" />
      ) : (
        <ul className="space-y-2">
          {plan.jobs.map((job) => (
            <li key={job.id}>
              <JobRow job={job} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
