import type { WorkerJob, WorkerJobStatus } from '@/lib/worker/types';

export type WorkerTone = 'blue' | 'green' | 'amber' | 'rose' | 'slate' | 'sky' | 'indigo';
export type WorkerTag = { label: string; tone: WorkerTone };

/** Statuses a worker never sees as part of their work. */
export const HIDDEN_STATUSES: ReadonlySet<string> = new Set(['pending', 'pending_send', 'cancelled']);
/** Finished with: done, or reported as not completed. */
export const FINISHED_STATUSES: ReadonlySet<string> = new Set(['completed', 'incomplete']);
/** Started and not finished. */
export const UNDERWAY_STATUSES: ReadonlySet<string> = new Set(['en_route', 'arrived', 'in_progress', 'paused']);
/** Not finished and not declined: the "upcoming" list. */
export const UNFINISHED_STATUSES: readonly WorkerJobStatus[] = [
  'assigned',
  'accepted',
  'en_route',
  'arrived',
  'in_progress',
  'paused',
];

/**
 * One colour per meaning, the same as the phone: blue = under way, amber = held up or
 * not finished, green = done, rose = declined, sky = waiting for you.
 */
export function workerTag(job: Pick<WorkerJob, 'status'>): WorkerTag | null {
  switch (job.status) {
    case 'assigned':
      return { label: 'Waiting for you', tone: 'sky' };
    case 'accepted':
      return { label: 'Accepted', tone: 'amber' };
    case 'en_route':
      return { label: 'On the way', tone: 'indigo' };
    case 'arrived':
    case 'in_progress':
      return { label: 'In progress', tone: 'blue' };
    case 'paused':
      return { label: 'Paused', tone: 'amber' };
    case 'completed':
      return { label: 'Done', tone: 'green' };
    case 'incomplete':
      return { label: 'Not completed', tone: 'amber' };
    case 'declined':
      return { label: 'Declined', tone: 'rose' };
    default:
      return null;
  }
}

/** The Urgent tag shows for high and emergency priority, as on the phone. */
export function isUrgent(job: Pick<WorkerJob, 'priority'>): boolean {
  return job.priority === 'high' || job.priority === 'emergency';
}
