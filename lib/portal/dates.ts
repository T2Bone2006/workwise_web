/**
 * Date helpers for the customer portal. Job dates are plain calendar days in
 * London; timestamps are shown in London time whatever the server's zone is.
 */

const LONDON = 'Europe/London';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseDay(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return { y, m, d };
}

/** Today in London as YYYY-MM-DD. */
export function londonToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: LONDON,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function addDays(iso: string, days: number): string {
  const { y, m, d } = parseDay(iso);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The Monday of the week containing this day. */
export function weekStartOf(iso: string): string {
  const { y, m, d } = parseDay(iso);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addDays(iso, -dow);
}

/** Whole days from `fromIso` to `toIso` (negative when `toIso` is earlier). */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = parseDay(fromIso);
  const b = parseDay(toIso);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

/** "Tue 27 Oct". */
export function formatDay(iso: string): string {
  const { y, m, d } = parseDay(iso);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[dow]} ${d} ${MONTHS[m - 1]}`;
}

/** "Today", "Tomorrow", or "Tue 27 Oct". */
export function formatDayRelative(iso: string, today: string): string {
  const diff = daysBetween(today, iso);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return formatDay(iso);
}

/** "09:00" from a database time such as "09:00:00". Null when there isn't one. */
export function formatTimeOfDay(time: string | null | undefined): string | null {
  if (!time || time.length < 5) return null;
  return time.slice(0, 5);
}

/** London time parts for a timestamp. Null when it can't be read. */
export function stampParts(iso: string | null | undefined): { date: string; time: string } | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    date: `${get('weekday')} ${get('day')} ${get('month')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
}

/** "Tue 27 Oct, 14:32". */
export function formatStamp(iso: string | null | undefined): string | null {
  const parts = stampParts(iso);
  return parts ? `${parts.date}, ${parts.time}` : null;
}

/** Minutes between two timestamps, or null when either is missing or the order is wrong. */
export function minutesBetween(fromIso: string | null | undefined, toIso: string | null | undefined): number | null {
  if (!fromIso || !toIso) return null;
  const diff = (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60_000;
  return Number.isFinite(diff) && diff >= 0 ? Math.round(diff) : null;
}

/** "28/10/2026" from a calendar day, or "" when there isn't one. */
export function formatNumericDay(iso: string | null | undefined): string {
  if (!iso) return '';
  const { y, m, d } = parseDay(iso);
  if (!y || !m || !d) return '';
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

/** "28/10/2026 14:32" in London time from a timestamp, or "" when it can't be read. */
export function formatNumericStamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}
