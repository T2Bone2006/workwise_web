/**
 * Shared job status labels and colours for client and server UI.
 * Kept separate from `lib/data/jobs` so client components do not bundle Supabase server code.
 */
export type JobStatusUi =
  | 'pending'
  | 'pending_send'
  | 'assigned'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

/** DB `assigned` is shown in UI as Paused (amber). */
export const JOB_STATUS_DISPLAY: Record<
  JobStatusUi,
  { label: string; summaryBarClass: string; badgeClass: string }
> = {
  pending: {
    label: 'Not Started',
    summaryBarClass:
      'border-slate-400/50 bg-slate-500/10 text-slate-800 dark:text-slate-200 border',
    badgeClass:
      'border-slate-400/60 bg-slate-500/10 text-slate-800 dark:text-slate-200 shadow-[0_0_12px_-2px_rgba(100,116,139,0.2)]',
  },
  pending_send: {
    label: 'Ready to send',
    summaryBarClass:
      'border-cyan-400/50 bg-cyan-500/10 text-cyan-950 dark:text-cyan-200 border',
    badgeClass:
      'border-cyan-400/60 bg-cyan-500/10 text-cyan-950 dark:text-cyan-200 shadow-[0_0_12px_-2px_rgba(6,182,212,0.25)]',
  },
  in_progress: {
    label: 'In Progress',
    summaryBarClass: 'border-blue-400/50 bg-blue-500/10 text-blue-800 dark:text-blue-300 border',
    badgeClass:
      'border-blue-400/60 bg-blue-500/10 text-blue-800 dark:text-blue-300 shadow-[0_0_12px_-2px_rgba(59,130,246,0.25)]',
  },
  assigned: {
    label: 'Paused',
    summaryBarClass: 'border-amber-400/50 bg-amber-500/10 text-amber-900 dark:text-amber-300 border',
    badgeClass:
      'border-amber-400/60 bg-amber-500/10 text-amber-900 dark:text-amber-300 shadow-[0_0_12px_-2px_rgba(245,158,11,0.25)]',
  },
  completed: {
    label: 'Completed',
    summaryBarClass:
      'border-emerald-400/50 bg-emerald-500/10 text-emerald-900 dark:text-emerald-300 border',
    badgeClass:
      'border-emerald-400/60 bg-emerald-500/10 text-emerald-900 dark:text-emerald-300 shadow-[0_0_12px_-2px_rgba(16,185,129,0.25)]',
  },
  cancelled: {
    label: 'Cancelled',
    summaryBarClass: 'border-red-400/40 bg-red-500/10 text-red-800 dark:text-red-300 border',
    badgeClass:
      'border-red-300/50 bg-red-500/10 text-red-700 dark:text-red-400/90 shadow-[0_0_8px_-2px_rgba(239,68,68,0.2)]',
  },
};
