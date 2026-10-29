import { addDays } from '@/lib/portal/dates';
import { NOT_STARTED_STATUSES } from '@/lib/portal/overview';

/**
 * The choices on the portal Export window. Pure, so the date and status rules can be
 * tested without a browser.
 */

export type ExportStatusChoice = 'all' | 'completed' | 'incomplete' | 'todo' | 'screen';

/** The statuses behind each plain-English choice. `screen` means "whatever the table has". */
export const EXPORT_STATUSES: Record<Exclude<ExportStatusChoice, 'all' | 'screen'>, string[]> = {
  completed: ['completed'],
  incomplete: ['incomplete'],
  todo: [...NOT_STARTED_STATUSES, 'in_progress', 'paused'],
};

export const EXPORT_STATUS_LABELS: Record<Exclude<ExportStatusChoice, 'screen'>, string> = {
  all: 'All jobs',
  completed: 'Completed',
  incomplete: 'Not completed',
  todo: 'Not finished yet',
};

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

/** Which choice the table's current status filter corresponds to. */
export function choiceForStatuses(statuses: string[]): ExportStatusChoice {
  if (statuses.length === 0) return 'all';
  for (const key of ['completed', 'incomplete', 'todo'] as const) {
    if (sameSet(statuses, EXPORT_STATUSES[key])) return key;
  }
  return 'screen';
}

export type DatePreset = 'this_month' | 'last_month' | 'last_30' | 'all';

export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  this_month: 'This month',
  last_month: 'Last month',
  last_30: 'Last 30 days',
  all: 'All dates',
};

/** The first and last day for a quick pick. `today` is a London YYYY-MM-DD. */
export function presetRange(preset: DatePreset, today: string): { from: string; to: string } {
  if (preset === 'all') return { from: '', to: '' };
  if (preset === 'last_30') return { from: addDays(today, -29), to: today };
  const monthStart = `${today.slice(0, 7)}-01`;
  if (preset === 'this_month') return { from: monthStart, to: addDays(nextMonthStart(monthStart), -1) };
  const lastMonthEnd = addDays(monthStart, -1);
  return { from: `${lastMonthEnd.slice(0, 7)}-01`, to: lastMonthEnd };
}

function nextMonthStart(monthStart: string): string {
  const year = Number(monthStart.slice(0, 4));
  const month = Number(monthStart.slice(5, 7));
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

/** Date boxes: a missing or backwards pair is "not ready to count", never a silent swap. */
export function rangeProblem(from: string, to: string): string | null {
  if (from && to && from > to) return 'The "from" day is after the "to" day.';
  return null;
}
