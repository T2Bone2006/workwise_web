import { addDays, isoWeekday } from '@/lib/rounds/dates';
import { weekStart } from '@/lib/worker/dashboard';
import { planDay } from '@/lib/worker/day-plan';
import { UNDERWAY_STATUSES, isUrgent, workerTag } from '@/lib/worker/status';
import type { WorkerJob } from '@/lib/worker/types';

/**
 * The worker Week board, laid out like the Rounds one (`lib/rounds/week-board.ts`):
 * the same window (2 weeks back, this week, 3 ahead), the same step when you scroll,
 * Monday to Friday on screen. Read-only — a card is a job, not a stop you can move.
 */

export const WEEK_BOARD_WEEKS_BACK = 2;
export const WEEK_BOARD_WEEKS = 6;
export const WEEK_BOARD_STEP_WEEKS = 2;
export const WEEK_BOARD_MAX_WEEKS = 16;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export type WorkerBoardState = 'planned' | 'underway' | 'done' | 'incomplete';

export type WorkerBoardCard = {
  id: string;
  /** Customer name, else the first line of the address, else the job title. */
  name: string;
  street: string;
  postcode: string;
  title: string;
  time: string | null;
  state: WorkerBoardState;
  urgent: boolean;
  /** "Waiting for you", "Done", … */
  tag: string | null;
};

export type WorkerBoardDay = {
  date: string;
  /** 1 Mon … 7 Sun */
  weekday: number;
  jobs: WorkerBoardCard[];
  total: number;
  done: number;
  isToday: boolean;
  isPast: boolean;
};

export type WorkerBoardWeek = {
  weekStart: string;
  /** "w/c 5 Oct" */
  label: string;
  days: WorkerBoardDay[];
};

export type WorkerBoardRange = { from: string; weeks: number };

function parts(ymd: string): { year: number; month: number; day: number } {
  const [y, m, d] = ymd.split('-').map(Number);
  return { year: y ?? 1970, month: m ?? 1, day: d ?? 1 };
}

/** "Thu 8 Oct" — the same shape as the Rounds board. */
export function formatWorkerBoardDay(ymd: string): string {
  const { year, month, day } = parts(ymd);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${weekday} ${day} ${MONTHS[month - 1]}`;
}

function weekLabel(start: string): string {
  const { month, day } = parts(start);
  return `w/c ${day} ${MONTHS[month - 1]}`;
}

/** Two weeks back and three ahead, counting the week that holds `date`. */
export function weekBoardRange(date: string): WorkerBoardRange & { to: string } {
  const from = addDays(weekStart(date), -7 * WEEK_BOARD_WEEKS_BACK);
  return { from, weeks: WEEK_BOARD_WEEKS, to: rangeEnd({ from, weeks: WEEK_BOARD_WEEKS }) };
}

/** The last Sunday the range covers. */
export function rangeEnd(range: WorkerBoardRange): string {
  return addDays(weekStart(range.from), range.weeks * 7 - 1);
}

/** Two more weeks that way, never more than 16 in total (the far end is dropped). */
export function extendWeekRange(range: WorkerBoardRange, dir: 'earlier' | 'later'): WorkerBoardRange {
  const step = WEEK_BOARD_STEP_WEEKS;
  if (dir === 'earlier') {
    return {
      from: addDays(range.from, -7 * step),
      weeks: Math.min(range.weeks + step, WEEK_BOARD_MAX_WEEKS),
    };
  }
  const weeks = range.weeks + step;
  if (weeks <= WEEK_BOARD_MAX_WEEKS) return { from: range.from, weeks };
  return { from: addDays(range.from, (weeks - WEEK_BOARD_MAX_WEEKS) * 7), weeks: WEEK_BOARD_MAX_WEEKS };
}

function firstLine(address: string | null): string {
  if (!address) return '';
  return address.split(/[\n,]/)[0]?.trim() ?? '';
}

function cardState(job: WorkerJob): WorkerBoardState {
  if (job.status === 'completed') return 'done';
  if (job.status === 'incomplete') return 'incomplete';
  if (UNDERWAY_STATUSES.has(job.status)) return 'underway';
  return 'planned';
}

function toCard(job: WorkerJob): WorkerBoardCard {
  const street = firstLine(job.address);
  return {
    id: job.id,
    name: job.customerName?.trim() || street || job.title,
    street,
    postcode: job.postcode?.trim() ?? '',
    title: job.title,
    time: job.scheduledTime,
    state: cardState(job),
    urgent: isUrgent(job),
    tag: workerTag(job)?.label ?? null,
  };
}

/** Monday to Friday, matching the Rounds board (weekend jobs stay on Day and Month). */
export function shownBoardDays(days: readonly WorkerBoardDay[]): WorkerBoardDay[] {
  return days.filter((day) => day.weekday <= 5);
}

/** One column per day, Monday first, for `weeks` starting at the Monday of `from`. */
export function buildWorkerWeeks(p: {
  jobs: readonly WorkerJob[];
  from: string;
  weeks: number;
  today: string;
}): WorkerBoardWeek[] {
  const start = weekStart(p.from);
  const weeks: WorkerBoardWeek[] = [];
  for (let w = 0; w < p.weeks; w += 1) {
    const startOfWeek = addDays(start, w * 7);
    const days: WorkerBoardDay[] = [];
    for (let d = 0; d < 7; d += 1) {
      const date = addDays(startOfWeek, d);
      const plan = planDay(p.jobs, date);
      days.push({
        date,
        weekday: isoWeekday(date),
        jobs: plan.jobs.map(toCard),
        total: plan.total,
        done: plan.done,
        isToday: date === p.today,
        isPast: date < p.today,
      });
    }
    weeks.push({ weekStart: startOfWeek, label: weekLabel(startOfWeek), days });
  }
  return weeks;
}
