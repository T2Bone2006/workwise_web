export type Ymd = string; // 'YYYY-MM-DD'

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function utcDateFromParts(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function formatYmd(year: number, month: number, day: number): Ymd {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  const utc = utcDateFromParts(year, month, day);
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() + 1 === month &&
    utc.getUTCDate() === day
  );
}

function partsFromYmd(ymd: Ymd): { year: number; month: number; day: number } {
  const match = YMD_RE.exec(ymd);
  if (!match) {
    throw new Error(`Invalid Ymd: ${ymd}`);
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

export function isValidYmd(value: unknown): value is Ymd {
  if (typeof value !== 'string' || !YMD_RE.test(value)) return false;
  const { year, month, day } = partsFromYmd(value);
  return isRealCalendarDate(year, month, day);
}

export function todayInLondon(now: Date = new Date()): Ymd {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function addDays(ymd: Ymd, days: number): Ymd {
  const { year, month, day } = partsFromYmd(ymd);
  const utc = utcDateFromParts(year, month, day);
  utc.setUTCDate(utc.getUTCDate() + days);
  return formatYmd(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
}

export function diffDays(from: Ymd, to: Ymd): number {
  const startParts = partsFromYmd(from);
  const endParts = partsFromYmd(to);
  const start = utcDateFromParts(startParts.year, startParts.month, startParts.day);
  const end = utcDateFromParts(endParts.year, endParts.month, endParts.day);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

export function isoWeekday(ymd: Ymd): number {
  const { year, month, day } = partsFromYmd(ymd);
  const jsDay = utcDateFromParts(year, month, day).getUTCDay(); // 0 Sun .. 6 Sat
  return jsDay === 0 ? 7 : jsDay;
}

export function compareYmd(a: Ymd, b: Ymd): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function startOfMonth(ymd: Ymd): Ymd {
  const { year, month } = partsFromYmd(ymd);
  return formatYmd(year, month, 1);
}

export function endOfMonth(ymd: Ymd): Ymd {
  const { year, month } = partsFromYmd(ymd);
  const last = utcDateFromParts(year, month + 1, 0);
  return formatYmd(last.getUTCFullYear(), last.getUTCMonth() + 1, last.getUTCDate());
}

export function ymdFromDate(d: Date): Ymd {
  return formatYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}
