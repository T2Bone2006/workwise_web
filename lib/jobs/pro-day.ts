/**
 * What the Pro jobs home shows about one day: how many are done, who is on a
 * job right now and who is free. Pure, so it can be tested without a database.
 */

export type DayJob = {
  id: string;
  status: string;
  workerId: string | null;
  reference: string | null;
};

export type DayWorker = { id: string; name: string };

export type DayCounts = {
  total: number;
  done: number;
  onJob: number;
  /** Not started yet: pending, ready to send, assigned. */
  waiting: number;
  notCompleted: number;
  /** Cancelled jobs are left out of the total. */
  cancelled: number;
};

export type TeamMember = {
  id: string;
  name: string;
  total: number;
  done: number;
  /** In progress or paused right now. */
  onJob: boolean;
  /** The job they're on (reference), when onJob. */
  currentReference: string | null;
};

const WAITING = new Set(['pending', 'pending_send', 'assigned', 'accepted', 'en_route', 'arrived']);
const ON_JOB = new Set(['in_progress', 'paused']);

export function summariseDay(jobs: DayJob[]): DayCounts {
  const counts: DayCounts = { total: 0, done: 0, onJob: 0, waiting: 0, notCompleted: 0, cancelled: 0 };
  for (const job of jobs) {
    if (job.status === 'cancelled') {
      counts.cancelled += 1;
      continue;
    }
    // A declined job is waiting for a new worker, so it still counts as work for the day.
    counts.total += 1;
    if (job.status === 'completed') counts.done += 1;
    else if (job.status === 'incomplete') counts.notCompleted += 1;
    else if (ON_JOB.has(job.status)) counts.onJob += 1;
    else if (WAITING.has(job.status) || job.status === 'declined') counts.waiting += 1;
  }
  return counts;
}

/** Every worker, busiest first, with how their day is going. Workers with no jobs stay in the list (they're free). */
export function teamForDay(workers: DayWorker[], jobs: DayJob[]): TeamMember[] {
  const byWorker = new Map<string, DayJob[]>();
  for (const job of jobs) {
    if (!job.workerId || job.status === 'cancelled') continue;
    const list = byWorker.get(job.workerId) ?? [];
    list.push(job);
    byWorker.set(job.workerId, list);
  }
  return workers
    .map((w): TeamMember => {
      const mine = byWorker.get(w.id) ?? [];
      const current = mine.find((j) => ON_JOB.has(j.status)) ?? null;
      return {
        id: w.id,
        name: w.name,
        total: mine.length,
        done: mine.filter((j) => j.status === 'completed' || j.status === 'incomplete').length,
        onJob: current !== null,
        currentReference: current?.reference ?? null,
      };
    })
    .sort((a, b) => Number(b.onJob) - Number(a.onJob) || b.total - a.total || a.name.localeCompare(b.name));
}

/** "Tom, Priya and 1 more" for the line under the on-the-job tile. */
export function namesLine(names: string[], max = 2): string {
  if (names.length === 0) return '';
  const first = names.slice(0, max).map((n) => n.split(/\s+/)[0]);
  const more = names.length - first.length;
  if (more > 0) return `${first.join(', ')} and ${more} more`;
  return first.length === 2 ? `${first[0]} and ${first[1]}` : first[0]!;
}
