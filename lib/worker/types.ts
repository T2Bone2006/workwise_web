/**
 * What the worker area knows about a job. Read-only: no money, no other workers.
 *
 * The status list is the database enum (public.job_status). lib/data/jobs.ts has an
 * older, shorter union for the office; the worker area needs the real values
 * (accepted, en_route, arrived) because those are what the phone writes.
 */

export const WORKER_JOB_STATUSES = [
  'pending',
  'pending_send',
  'assigned',
  'accepted',
  'declined',
  'en_route',
  'arrived',
  'in_progress',
  'paused',
  'completed',
  'incomplete',
  'cancelled',
] as const;

export type WorkerJobStatus = (typeof WORKER_JOB_STATUSES)[number];

export type WorkerJobPriority = 'low' | 'normal' | 'high' | 'emergency';

export type WorkerJob = {
  id: string;
  referenceNumber: string | null;
  /** First line of the job description, trimmed to fit a row. */
  title: string;
  status: WorkerJobStatus;
  priority: WorkerJobPriority | null;
  /** 'YYYY-MM-DD', the Europe/London day. */
  scheduledDate: string | null;
  /** 'HH:MM'. */
  scheduledTime: string | null;
  address: string | null;
  postcode: string | null;
  customerName: string | null;
  completedAt: string | null;
  /** Why a job was not completed, from the history row's metadata.blocked_by. */
  notBecause: string | null;
};

export type WorkerJobDetail = WorkerJob & {
  /** The full job description. */
  description: string;
  /** Job sheet rows the employer chose to show this worker. */
  sheet: Array<{ label: string; value: string }>;
  customerPhone: string | null;
  /** True when this worker declined the job (the sheet is trimmed). */
  declinedByMe: boolean;
  history: Array<{ at: string; label: string }>;
};

export type JobsTab = 'upcoming' | 'done' | 'not_completed' | 'declined';

export const JOBS_TABS: readonly JobsTab[] = ['upcoming', 'done', 'not_completed', 'declined'];

export function parseJobsTab(value: unknown): JobsTab {
  return JOBS_TABS.includes(value as JobsTab) ? (value as JobsTab) : 'upcoming';
}
