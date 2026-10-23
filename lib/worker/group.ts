import { format, parseISO } from 'date-fns';
import { addDays } from '@/lib/rounds/dates';
import type { WorkerJob } from '@/lib/worker/types';

export type JobGroup = { key: string; label: string; jobs: WorkerJob[] };

/** Groups keep the order the jobs came in; a job with no day goes in one group at the end. */
function group(jobs: readonly WorkerJob[], keyOf: (job: WorkerJob) => string | null, labelOf: (key: string) => string, emptyLabel: string): JobGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, WorkerJob[]>();
  const undated: WorkerJob[] = [];
  for (const job of jobs) {
    const key = keyOf(job);
    if (!key) {
      undated.push(job);
      continue;
    }
    const list = byKey.get(key);
    if (list) list.push(job);
    else {
      byKey.set(key, [job]);
      order.push(key);
    }
  }
  const out = order.map((key) => ({ key, label: labelOf(key), jobs: byKey.get(key) as WorkerJob[] }));
  if (undated.length > 0) out.push({ key: 'undated', label: emptyLabel, jobs: undated });
  return out;
}

/** "Today", "Tomorrow", then "Thu 30 Oct". Used for what is coming up. */
export function groupByDay(jobs: readonly WorkerJob[], today: string): JobGroup[] {
  const tomorrow = addDays(today, 1);
  return group(
    jobs,
    (job) => job.scheduledDate,
    (ymd) => (ymd === today ? 'Today' : ymd === tomorrow ? 'Tomorrow' : format(parseISO(ymd), 'EEE d MMM')),
    'No day set',
  );
}

/** "October 2026". Used for the history lists, which can run long. Done jobs group by when they were finished. */
export function groupByMonth(jobs: readonly WorkerJob[], by: 'scheduled' | 'completed' = 'scheduled'): JobGroup[] {
  return group(
    jobs,
    (job) => {
      const day = by === 'completed' ? (job.completedAt?.slice(0, 10) ?? job.scheduledDate) : job.scheduledDate;
      return day ? day.slice(0, 7) : null;
    },
    (month) => format(parseISO(`${month}-01`), 'MMMM yyyy'),
    'No date',
  );
}
