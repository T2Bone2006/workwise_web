import type { Tone } from '@/components/look/tones';

/**
 * The story of one job for the customer: what happened and when, oldest first.
 * Pure, so it can be tested without a database.
 */

export type TimelineEvent = {
  key: string;
  label: string;
  at: string;
  tone: Tone;
};

export type HistoryRow = {
  id: string;
  from_status: string | null;
  to_status: string;
  created_at: string;
};

const LABELS: Record<string, { label: string; tone: Tone }> = {
  assigned: { label: 'Engineer assigned', tone: 'indigo' },
  accepted: { label: 'Engineer accepted the job', tone: 'indigo' },
  in_progress: { label: 'Work started', tone: 'sky' },
  paused: { label: 'Work paused', tone: 'amber' },
  completed: { label: 'Completed', tone: 'emerald' },
  incomplete: { label: 'Marked not completed', tone: 'rose' },
  declined: { label: 'Being reassigned', tone: 'slate' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
};

/** Office-only steps the customer has no use for. */
const HIDDEN = new Set(['pending', 'pending_send']);

/** A start within this long of arriving is the same moment, so it isn't listed twice. */
const SAME_MOMENT_MS = 60_000;

export function buildTimeline(input: {
  createdAt: string | null;
  arrivedAt: string | null;
  history: HistoryRow[];
  /**
   * The phone changes a job's status without logging each step, so the steps are
   * filled in from the job's own timestamps when the history doesn't have them.
   */
  status?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  /** Only used while the job is still 'accepted': then the last change was the acceptance. */
  updatedAt?: string | null;
}): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  if (input.createdAt) {
    events.push({ key: 'raised', label: 'Job raised', at: input.createdAt, tone: 'slate' });
  }

  let previous: string | null = null;
  const ordered = input.history.slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const row of ordered) {
    if (HIDDEN.has(row.to_status) || row.to_status === previous) continue;
    const known = LABELS[row.to_status];
    if (!known) continue;
    previous = row.to_status;
    events.push({ key: row.id, label: known.label, at: row.created_at, tone: known.tone });
  }

  const logged = new Set(ordered.map((row) => row.to_status));

  if (input.arrivedAt) {
    events.push({ key: 'arrived', label: 'Engineer arrived', at: input.arrivedAt, tone: 'sky' });
  }

  if (input.status === 'accepted' && !logged.has('accepted') && input.updatedAt) {
    events.push({ key: 'accepted', label: LABELS.accepted.label, at: input.updatedAt, tone: LABELS.accepted.tone });
  }

  if (input.startedAt && !logged.has('in_progress')) {
    const apart = input.arrivedAt
      ? Math.abs(new Date(input.startedAt).getTime() - new Date(input.arrivedAt).getTime())
      : Infinity;
    if (!(apart < SAME_MOMENT_MS)) {
      events.push({ key: 'started', label: LABELS.in_progress.label, at: input.startedAt, tone: LABELS.in_progress.tone });
    }
  }

  if (input.status === 'completed' && input.completedAt && !logged.has('completed')) {
    events.push({ key: 'completed', label: LABELS.completed.label, at: input.completedAt, tone: LABELS.completed.tone });
  }

  return events.sort((a, b) => a.at.localeCompare(b.at));
}
