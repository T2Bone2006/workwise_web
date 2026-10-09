import type { WorkerJob, WorkerJobPriority, WorkerJobStatus } from '@/lib/worker/types';
import { WORKER_JOB_STATUSES } from '@/lib/worker/types';

/** The columns the worker area reads. Never money, never another worker. */
export const WORKER_JOB_COLUMNS =
  'id, reference_number, job_description, status, priority, scheduled_date, scheduled_time, address, postcode, completed_at, created_at';

export type JobRowForWorker = {
  id: string;
  reference_number: string | null;
  job_description: string | null;
  status: string | null;
  priority: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  address: string | null;
  postcode: string | null;
  completed_at: string | null;
  customers?: { name?: string | null } | { name?: string | null }[] | null;
};

const TITLE_MAX = 90;

/** First non-empty line of the description, shortened to fit a row. */
export function titleFromDescription(description: string | null | undefined): string {
  const first = (description ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!first) return 'Job';
  return first.length > TITLE_MAX ? `${first.slice(0, TITLE_MAX - 1).trimEnd()}…` : first;
}

/** 'HH:MM:SS' or 'HH:MM' -> 'HH:MM'. */
export function hhmm(time: string | null | undefined): string | null {
  if (!time) return null;
  const match = /^(\d{2}):(\d{2})/.exec(time);
  return match ? `${match[1]}:${match[2]}` : null;
}

function asStatus(value: string | null): WorkerJobStatus | null {
  return (WORKER_JOB_STATUSES as readonly string[]).includes(value ?? '') ? (value as WorkerJobStatus) : null;
}

function asPriority(value: string | null): WorkerJobPriority | null {
  return value === 'low' || value === 'normal' || value === 'high' || value === 'emergency' ? value : null;
}

function customerName(customers: JobRowForWorker['customers']): string | null {
  const one = Array.isArray(customers) ? customers[0] : customers;
  const name = one?.name?.trim();
  return name ? name : null;
}

/** Maps a database row to what the worker area shows; a row with an unknown status is dropped (null). */
export function mapJobRow(row: JobRowForWorker, notBecause: string | null = null): WorkerJob | null {
  const status = asStatus(row.status);
  if (!status) return null;
  return {
    id: row.id,
    referenceNumber: row.reference_number,
    title: titleFromDescription(row.job_description),
    status,
    priority: asPriority(row.priority),
    scheduledDate: row.scheduled_date,
    scheduledTime: hhmm(row.scheduled_time),
    address: row.address?.trim() || null,
    postcode: row.postcode?.trim() || null,
    customerName: customerName(row.customers),
    completedAt: row.completed_at,
    notBecause,
  };
}

/**
 * Why a job was not completed. The phone writes metadata.blocked_by on the history row;
 * it can be text, a list of texts or a list of { label | question | answer } objects.
 */
export function blockedReason(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const blocked = (metadata as Record<string, unknown>).blocked_by;
  const parts: string[] = [];
  const add = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) parts.push(value.trim());
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      const text = [obj.label, obj.question, obj.title, obj.name].find(
        (v): v is string => typeof v === 'string' && v.trim().length > 0,
      );
      if (text) parts.push(text.trim());
    }
  };
  if (Array.isArray(blocked)) blocked.forEach(add);
  else add(blocked);
  return parts.length > 0 ? parts.join(', ') : null;
}

export type HistoryRowLite = {
  to_status: string | null;
  created_at: string | null;
  metadata?: unknown;
};

/** The line shown for one history row, or null for rows the worker should not see. */
export function historyLabel(row: HistoryRowLite): string | null {
  switch (row.to_status) {
    case 'assigned':
      return 'Sent to you';
    case 'accepted':
      return 'You accepted it';
    case 'declined':
      return 'You declined it';
    case 'en_route':
      return 'You set off';
    case 'arrived':
      return 'You arrived';
    case 'in_progress':
      return 'Started';
    case 'paused':
      return 'Paused';
    case 'completed':
      return 'Completed';
    case 'incomplete': {
      const why = blockedReason(row.metadata);
      return why ? `Not completed: ${why}` : 'Not completed';
    }
    case 'cancelled':
      return 'Cancelled by the office';
    default:
      return null;
  }
}

/** History rows -> lines, oldest first, dropping rows with no label or no time. */
export function historyLines(rows: readonly HistoryRowLite[]): Array<{ at: string; label: string }> {
  const out: Array<{ at: string; label: string }> = [];
  for (const row of rows) {
    const label = historyLabel(row);
    if (!label || !row.created_at) continue;
    out.push({ at: row.created_at, label });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
