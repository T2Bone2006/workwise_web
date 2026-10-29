import { addDays, daysBetween, weekStartOf } from '@/lib/portal/dates';

/**
 * What the customer's home page shows, worked out from their jobs. Pure, so it
 * can be tested without a database.
 */

/** Booked but not started: the ones that can be late. */
export const NOT_STARTED_STATUSES = ['pending', 'pending_send', 'assigned', 'accepted'] as const;

export type PortalJobRow = {
  id: string;
  reference_number: string | null;
  address: string | null;
  status: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  completed_at: string | null;
  arrived_at: string | null;
  updated_at: string | null;
  industry_data: Record<string, unknown> | null;
};

export type PortalJobItem = {
  id: string;
  reference: string;
  address: string;
  status: string;
  scheduledDate: string | null;
  scheduledTime: string | null;
};

export type AttentionKind = 'not_completed' | 'overdue';

export type AttentionItem = PortalJobItem & {
  kind: AttentionKind;
  /** What the engineer wrote when they couldn't finish. Not completed only. */
  reason: string | null;
  /** When the job was marked not completed. */
  happenedAt: string | null;
  /** Whole days past the booked day. Overdue only. */
  daysLate: number;
  photoUrl: string | null;
  photoCount: number;
};

export type PortalWeek = {
  /** Monday to Sunday of this week, YYYY-MM-DD. */
  start: string;
  end: string;
  booked: number;
  done: number;
  /** Every job marked not completed, however old. */
  notCompleted: number;
  /** Every booked job whose day has passed without a visit starting, however old. */
  overdue: number;
  /** Share of finished visits in the last 30 days that were completed. Null when none finished. */
  completionRate: number | null;
  finishedLast30: number;
};

export type PortalOverviewData = {
  attention: AttentionItem[];
  /** How many need attention in all, when more than are listed. */
  attentionTotal: number;
  week: PortalWeek;
};

export const ATTENTION_LIMIT = 3;

function toItem(row: PortalJobRow): PortalJobItem {
  return {
    id: row.id,
    reference: row.reference_number?.trim() || row.id.slice(0, 8),
    address: row.address?.trim() || '',
    status: row.status,
    scheduledDate: row.scheduled_date,
    scheduledTime: row.scheduled_time,
  };
}

/**
 * Where an engineer's reason for not finishing is kept. Every finish form has
 * `incomplete_reason`. A business that asks "did you walk away?" keeps the answer to
 * "why?" in `walk_away_detail` instead (the office editor wrote `walked_away_detail`).
 */
const REASON_KEYS = ['incomplete_reason', 'walk_away_detail', 'walked_away_detail'] as const;

/** The reason an engineer gave for not finishing, if they gave one. */
export function incompleteReason(industryData: Record<string, unknown> | null): string | null {
  for (const key of REASON_KEYS) {
    const value = industryData?.[key];
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (text.length > 0) return text;
  }
  return null;
}

/** One not-completed or overdue job, ready to show. Photos are added separately. */
export function toAttentionItem(row: PortalJobRow, kind: AttentionKind, today: string): AttentionItem {
  return {
    ...toItem(row),
    kind,
    reason: kind === 'not_completed' ? incompleteReason(row.industry_data) : null,
    happenedAt: kind === 'not_completed' ? row.updated_at : null,
    daysLate: kind === 'overdue' && row.scheduled_date ? daysBetween(row.scheduled_date, today) : 0,
    photoUrl: null,
    photoCount: 0,
  };
}

export type OverviewInput = {
  /** The customer's jobs booked from 30 days ago to the end of this week. */
  rows: PortalJobRow[];
  /** The most recently marked not-completed jobs. May be only the newest few. */
  incomplete: PortalJobRow[];
  /** Booked-but-never-started jobs whose day has passed. May be only the most recent few. */
  overdue: PortalJobRow[];
  /** How many there are in all, which can be more than the rows passed in. */
  incompleteTotal: number;
  overdueTotal: number;
};

export function buildOverview(input: OverviewInput, today: string): PortalOverviewData {
  const { rows, incomplete, overdue: overdueRows, incompleteTotal, overdueTotal } = input;
  const weekStart = weekStartOf(today);
  const weekEnd = addDays(weekStart, 6);
  const thirtyAgo = addDays(today, -30);

  const live = rows.filter((r) => r.status !== 'cancelled');

  const notCompleted = incomplete
    .slice()
    .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
    .map((row) => toAttentionItem(row, 'not_completed', today));

  const overdue = overdueRows
    .filter((r) => r.scheduled_date != null && r.scheduled_date < today)
    .map((row) => toAttentionItem(row, 'overdue', today))
    .sort((a, b) => a.daysLate - b.daysLate);

  const inWeek = live.filter((r) => r.scheduled_date != null && r.scheduled_date >= weekStart && r.scheduled_date <= weekEnd);
  const finished = rows.filter(
    (r) =>
      (r.status === 'completed' || r.status === 'incomplete') &&
      r.scheduled_date != null &&
      r.scheduled_date >= thirtyAgo &&
      r.scheduled_date <= today,
  );
  const completedOfFinished = finished.filter((r) => r.status === 'completed').length;

  return {
    attention: [...notCompleted, ...overdue].slice(0, ATTENTION_LIMIT),
    attentionTotal: incompleteTotal + overdueTotal,
    week: {
      start: weekStart,
      end: weekEnd,
      booked: inWeek.length,
      done: inWeek.filter((r) => r.status === 'completed').length,
      notCompleted: incompleteTotal,
      overdue: overdueTotal,
      completionRate: finished.length > 0 ? Math.round((completedOfFinished / finished.length) * 100) : null,
      finishedLast30: finished.length,
    },
  };
}
