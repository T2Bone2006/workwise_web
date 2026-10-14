import { FINISHED_STATUSES, HIDDEN_STATUSES, UNDERWAY_STATUSES } from '@/lib/worker/status';
import type { WorkerJob } from '@/lib/worker/types';

/** A worker's day, worked out from the jobs they already have. Mirrors the phone's day plan. */
export type DayPlan = {
  date: string;
  /** The day's jobs in the order to do them (declined are not part of the day). */
  jobs: WorkerJob[];
  total: number;
  /** Finished: the work was done. */
  done: number;
  /** Finished: reported as not completed. */
  notCompleted: number;
  /** Started and not finished. */
  underway: number;
  /** Sent to the worker, not accepted yet. */
  waiting: number;
  /** Everything not finished. */
  remaining: number;
  /** The job to do next: the one under way, else the first accepted. */
  next: WorkerJob | null;
};

function compareJobs(a: WorkerJob, b: WorkerJob): number {
  const at = a.scheduledTime ?? '99:99';
  const bt = b.scheduledTime ?? '99:99';
  if (at !== bt) return at < bt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function inTheirDay(job: WorkerJob): boolean {
  return !HIDDEN_STATUSES.has(job.status) && job.status !== 'declined';
}

export function planDay(jobs: readonly WorkerJob[], ymd: string): DayPlan {
  const day = jobs.filter((j) => j.scheduledDate === ymd && inTheirDay(j)).sort(compareJobs);

  let done = 0;
  let notCompleted = 0;
  let underway = 0;
  let waiting = 0;
  for (const job of day) {
    if (job.status === 'completed') done += 1;
    else if (job.status === 'incomplete') notCompleted += 1;
    else if (UNDERWAY_STATUSES.has(job.status)) underway += 1;
    else if (job.status === 'assigned' && !job.rounds) waiting += 1;
  }

  const next =
    day.find((j) => UNDERWAY_STATUSES.has(j.status)) ??
    day.find((j) => j.status === 'accepted' || (j.rounds && j.status === 'assigned')) ??
    null;

  return {
    date: ymd,
    jobs: day,
    total: day.length,
    done,
    notCompleted,
    underway,
    waiting,
    remaining: day.filter((j) => !FINISHED_STATUSES.has(j.status)).length,
    next,
  };
}

/** Jobs per day ('YYYY-MM-DD' -> count) for the calendar grid. Undated, hidden and declined jobs are not counted. */
export function dayCounts(jobs: readonly WorkerJob[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const job of jobs) {
    if (!job.scheduledDate || !inTheirDay(job)) continue;
    counts[job.scheduledDate] = (counts[job.scheduledDate] ?? 0) + 1;
  }
  return counts;
}

/** Days that have at least one urgent job, for the calendar's small dot. */
export function urgentDays(jobs: readonly WorkerJob[]): Set<string> {
  const days = new Set<string>();
  for (const job of jobs) {
    if (!job.scheduledDate || !inTheirDay(job)) continue;
    if (job.priority === 'high' || job.priority === 'emergency') days.add(job.scheduledDate);
  }
  return days;
}
