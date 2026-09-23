/**
 * Shared job status labels and colours for client and server UI.
 * Kept separate from `lib/data/jobs` so client components do not bundle Supabase server code.
 *
 * Badge / bar classes lean soft glass (tinted gradient + light blur) so they
 * sit with the page headers rather than reading as hard flat chips.
 */
export type JobStatusUi =
  | 'pending'
  | 'pending_send'
  | 'assigned'
  | 'in_progress'
  | 'paused'
  | 'completed'
  | 'incomplete'
  | 'declined'
  | 'cancelled';

const GLASS =
  'border backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]';

export const JOB_STATUS_DISPLAY: Record<
  JobStatusUi,
  { label: string; summaryBarClass: string; badgeClass: string }
> = {
  pending: {
    label: 'Pending',
    summaryBarClass: cnGlass(
      GLASS,
      'border-slate-300/70 bg-gradient-to-br from-slate-100/95 via-slate-50/80 to-slate-100/70 text-slate-800',
      'dark:border-slate-600/45 dark:from-slate-800/50 dark:via-slate-900/30 dark:to-slate-800/40 dark:text-slate-200'
    ),
    badgeClass: cnGlass(
      GLASS,
      'border-slate-300/65 bg-gradient-to-br from-slate-100/90 to-slate-50/70 text-slate-800',
      'dark:border-slate-600/40 dark:from-slate-800/45 dark:to-slate-900/30 dark:text-slate-200'
    ),
  },
  pending_send: {
    label: 'Ready to send',
    summaryBarClass: cnGlass(
      GLASS,
      'border-cyan-300/70 bg-gradient-to-br from-cyan-100/95 via-cyan-50/80 to-sky-100/70 text-cyan-950',
      'dark:border-cyan-700/45 dark:from-cyan-950/45 dark:via-sky-950/25 dark:to-cyan-900/30 dark:text-cyan-200'
    ),
    badgeClass: cnGlass(
      GLASS,
      'border-cyan-300/65 bg-gradient-to-br from-cyan-100/90 to-sky-50/70 text-cyan-950',
      'dark:border-cyan-700/40 dark:from-cyan-950/40 dark:to-sky-950/25 dark:text-cyan-200'
    ),
  },
  in_progress: {
    label: 'In Progress',
    summaryBarClass: cnGlass(
      GLASS,
      'border-blue-300/70 bg-gradient-to-br from-blue-100/95 via-sky-50/80 to-blue-100/70 text-blue-900',
      'dark:border-blue-700/45 dark:from-blue-950/45 dark:via-sky-950/25 dark:to-blue-900/30 dark:text-blue-200'
    ),
    badgeClass: cnGlass(
      GLASS,
      'border-blue-300/65 bg-gradient-to-br from-blue-100/90 to-sky-50/70 text-blue-900',
      'dark:border-blue-700/40 dark:from-blue-950/40 dark:to-sky-950/25 dark:text-blue-200'
    ),
  },
  paused: {
    label: 'Paused',
    summaryBarClass: cnGlass(
      GLASS,
      'border-amber-300/70 bg-gradient-to-br from-amber-100/95 via-amber-50/85 to-yellow-50/80 text-amber-900',
      'dark:border-amber-700/45 dark:from-amber-950/45 dark:via-amber-900/25 dark:to-yellow-950/20 dark:text-amber-200'
    ),
    badgeClass: cnGlass(
      GLASS,
      'border-amber-300/65 bg-gradient-to-br from-amber-100/90 to-yellow-50/70 text-amber-900',
      'dark:border-amber-700/40 dark:from-amber-950/40 dark:to-yellow-950/20 dark:text-amber-200'
    ),
  },
  assigned: {
    label: 'Assigned',
    summaryBarClass: cnGlass(
      GLASS,
      'border-amber-300/70 bg-gradient-to-br from-amber-100/95 via-orange-50/75 to-amber-100/70 text-amber-950',
      'dark:border-amber-700/45 dark:from-amber-950/45 dark:via-orange-950/20 dark:to-amber-900/30 dark:text-amber-200'
    ),
    badgeClass: cnGlass(
      GLASS,
      'border-amber-300/65 bg-gradient-to-br from-amber-100/90 to-orange-50/70 text-amber-950',
      'dark:border-amber-700/40 dark:from-amber-950/40 dark:to-orange-950/20 dark:text-amber-200'
    ),
  },
  completed: {
    label: 'Completed',
    summaryBarClass: cnGlass(
      GLASS,
      'border-emerald-300/70 bg-gradient-to-br from-emerald-100/95 via-teal-50/80 to-emerald-100/70 text-emerald-950',
      'dark:border-emerald-700/45 dark:from-emerald-950/45 dark:via-teal-950/20 dark:to-emerald-900/30 dark:text-emerald-200'
    ),
    badgeClass: cnGlass(
      GLASS,
      'border-emerald-300/65 bg-gradient-to-br from-emerald-100/90 to-teal-50/70 text-emerald-950',
      'dark:border-emerald-700/40 dark:from-emerald-950/40 dark:to-teal-950/20 dark:text-emerald-200'
    ),
  },
  incomplete: {
    label: 'Not completed',
    summaryBarClass: cnGlass(
      GLASS,
      'border-orange-300/70 bg-gradient-to-br from-orange-100/95 via-amber-50/80 to-orange-100/70 text-orange-950',
      'dark:border-orange-700/45 dark:from-orange-950/45 dark:via-amber-950/20 dark:to-orange-900/30 dark:text-orange-200'
    ),
    badgeClass: cnGlass(
      GLASS,
      'border-orange-300/65 bg-gradient-to-br from-orange-100/90 to-amber-50/70 text-orange-950',
      'dark:border-orange-700/40 dark:from-orange-950/40 dark:to-amber-950/20 dark:text-orange-200'
    ),
  },
  declined: {
    label: 'Declined',
    summaryBarClass: cnGlass(
      GLASS,
      'border-red-300/70 bg-gradient-to-br from-red-100/95 via-rose-50/80 to-red-100/70 text-red-950',
      'dark:border-red-800/45 dark:from-red-950/45 dark:via-rose-950/20 dark:to-red-900/30 dark:text-red-200'
    ),
    badgeClass: cnGlass(
      GLASS,
      'border-red-300/65 bg-gradient-to-br from-red-100/90 to-rose-50/70 text-red-900',
      'dark:border-red-800/40 dark:from-red-950/40 dark:to-rose-950/20 dark:text-red-200'
    ),
  },
  cancelled: {
    label: 'Cancelled',
    summaryBarClass: cnGlass(
      GLASS,
      'border-rose-300/60 bg-gradient-to-br from-rose-100/90 via-red-50/70 to-rose-100/60 text-rose-900',
      'dark:border-rose-800/40 dark:from-rose-950/40 dark:via-red-950/20 dark:to-rose-900/25 dark:text-rose-200'
    ),
    badgeClass: cnGlass(
      GLASS,
      'border-rose-300/55 bg-gradient-to-br from-rose-100/85 to-red-50/65 text-rose-900',
      'dark:border-rose-800/35 dark:from-rose-950/35 dark:to-red-950/20 dark:text-rose-300'
    ),
  },
};

function cnGlass(...parts: string[]): string {
  return parts.filter(Boolean).join(' ');
}
