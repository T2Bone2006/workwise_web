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

export function buildTimeline(input: {
  createdAt: string | null;
  arrivedAt: string | null;
  history: HistoryRow[];
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

  if (input.arrivedAt) {
    events.push({ key: 'arrived', label: 'Engineer arrived', at: input.arrivedAt, tone: 'sky' });
  }

  return events.sort((a, b) => a.at.localeCompare(b.at));
}
