export const QUIET_START_HOUR = 21; // 21:00 London
export const QUIET_END_HOUR = 7; // 07:00 London

const LONDON = 'Europe/London';

function londonParts(at: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** London wall-clock hour (0–23) at `at`. */
export function londonHour(at: Date): number {
  return londonParts(at).hour;
}

/** 'YYYY-MM' in London at `at` (matches SQL text_month_london). */
export function londonMonth(at: Date): string {
  const { year, month } = londonParts(at);
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** The UTC instant of a London wall-clock time on a London date (DST-safe). */
export function londonWallTimeToUtc(
  ymd: string,
  hour: number,
  minute: number,
): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) throw new Error(`Invalid Ymd: ${ymd}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  for (let i = 0; i < 4; i++) {
    const parts = formatter.formatToParts(new Date(utcMs));
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((p) => p.type === type)?.value);
    const asUtcMs = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
      get('second'),
    );
    const wantedMs = Date.UTC(year, month - 1, day, hour, minute, 0);
    const delta = wantedMs - asUtcMs;
    if (delta === 0) break;
    utcMs += delta;
  }

  return new Date(utcMs);
}

export function isQuietHours(at: Date): boolean {
  const hour = londonHour(at);
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

function formatYmd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addOneLondonDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + 1));
  return formatYmd(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
}

/** Next 07:00 London strictly after `at` if in quiet hours; `at` itself otherwise. */
export function sendableFrom(at: Date): Date {
  if (!isQuietHours(at)) return at;
  const { year, month, day, hour } = londonParts(at);
  const today = formatYmd(year, month, day);
  // 21:00–23:59 → next day 07:00; 00:00–06:59 → same day 07:00
  const targetYmd = hour >= QUIET_START_HOUR ? addOneLondonDay(today) : today;
  return londonWallTimeToUtc(targetYmd, QUIET_END_HOUR, 0);
}
