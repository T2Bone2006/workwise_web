import { addDays, endOfMonth, isValidYmd, startOfMonth } from '@/lib/rounds/dates';
import { weekStart } from '@/lib/worker/dashboard';
import { weekBoardRange } from '@/lib/worker/week-board';

export type WorkerCalendarView = 'month' | 'week' | 'day';

export function parseCalendarParams(
  input: { view?: unknown; date?: unknown },
  today: string,
): { view: WorkerCalendarView; date: string } {
  const view: WorkerCalendarView = input.view === 'day' ? 'day' : input.view === 'week' ? 'week' : 'month';
  const date = typeof input.date === 'string' && isValidYmd(input.date) ? input.date : today;
  return { view, date };
}

/** The days the month grid shows, Monday first, whole weeks only (35 or 42 days). */
export function monthGridDays(ymd: string): string[] {
  const first = startOfMonth(ymd);
  const last = endOfMonth(ymd);
  const start = weekStart(first);
  const days: string[] = [];
  for (let day = start; days.length % 7 !== 0 || day <= last; day = addDays(day, 1)) {
    days.push(day);
    if (days.length > 42) break;
  }
  return days;
}

/** First and last day to fetch for what is on screen. Week matches the Rounds board: six weeks, Monday to Sunday. */
export function calendarRange(view: WorkerCalendarView, date: string): { from: string; to: string } {
  if (view === 'day') return { from: date, to: date };
  if (view === 'week') {
    const range = weekBoardRange(date);
    return { from: range.from, to: range.to };
  }
  const days = monthGridDays(date);
  return { from: days[0], to: days[days.length - 1] };
}

/** The date the previous / next arrow goes to. A month steps from the 1st so it never skips a short month. */
export function stepDate(view: WorkerCalendarView, date: string, direction: -1 | 1): string {
  if (view === 'day') return addDays(date, direction);
  if (view === 'week') return addDays(date, direction * 7);
  const first = startOfMonth(date);
  return direction === 1 ? addDays(endOfMonth(first), 1) : startOfMonth(addDays(first, -1));
}
