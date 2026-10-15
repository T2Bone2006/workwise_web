import { Kpi } from './kpi';
import type { DayCounts } from '@/lib/jobs/pro-day';

/**
 * The four numbers a dispatcher wants on opening the page: how the day is going,
 * who is out on a job, what still needs a worker and what didn't get done.
 */
export function ProKpiTiles({
  day,
  isToday,
  counts,
  onJobNames,
  declined,
  unassigned,
  notCompleted,
}: {
  day: string;
  isToday: boolean;
  counts: DayCounts;
  onJobNames: string;
  declined: number;
  unassigned: number;
  notCompleted: number;
}) {
  const pctDone = counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0;
  const needWorker = declined + unassigned;
  const toDo = counts.total - counts.done - counts.notCompleted;

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      <Kpi
        href={`/dashboard?date=${day}&status=completed`}
        label={isToday ? 'Done today' : 'Done that day'}
        value={counts.total === 0 ? '0' : `${counts.done} of ${counts.total}`}
        figure="text-(--tone-emerald-solid)"
        sub={
          counts.total === 0 ? (
            'No jobs scheduled'
          ) : (
            <>
              <span>{toDo > 0 ? `${toDo} still to do` : 'Everything finished'}</span>
              <span
                className="mt-2 block h-1.5 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={pctDone}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Jobs done"
              >
                <span className="block h-full rounded-full bg-(--tone-emerald-solid)" style={{ width: `${pctDone}%` }} />
              </span>
            </>
          )
        }
      />

      <Kpi
        href={`/dashboard?date=${day}&status=in_progress,paused`}
        label="On a job now"
        value={String(counts.onJob)}
        figure="text-(--tone-sky-solid)"
        sub={counts.onJob > 0 ? onJobNames : isToday ? 'Nobody has started yet' : 'No jobs in progress'}
      />

      <Kpi
        href="/jobs?status=declined,pending"
        label="Need a worker"
        value={String(needWorker)}
        figure={needWorker > 0 ? 'text-(--tone-amber-solid)' : 'text-(--tone-emerald-solid)'}
        sub={
          needWorker > 0
            ? [declined > 0 ? `${declined} declined` : null, unassigned > 0 ? `${unassigned} not assigned` : null]
                .filter(Boolean)
                .join(' · ')
            : 'Every job has a worker'
        }
      />

      <Kpi
        href="/jobs?status=incomplete"
        label="Not completed"
        value={String(notCompleted)}
        figure={notCompleted > 0 ? 'text-(--tone-amber-solid)' : 'text-(--tone-emerald-solid)'}
        sub={notCompleted > 0 ? 'Last 14 days · follow up' : 'Nothing left unfinished'}
      />
    </div>
  );
}
