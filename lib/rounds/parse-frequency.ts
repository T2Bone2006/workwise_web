/** Named cadence in days. 28-day months, 91-day quarters, 182-day half-years. */
const MIN_DAYS = 1;
const MAX_DAYS = 365;

function clampDays(days: number): number | null {
  if (!Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) return null;
  return days;
}

function fromWeeks(weeks: number): number | null {
  return clampDays(weeks * 7);
}

function fromMonths(months: number): number | null {
  return clampDays(months * 28);
}

function wholeNumber(value: number): number | null {
  if (!Number.isFinite(value) || !Number.isInteger(value)) return null;
  return value;
}

/** Bare number ≤ 12 is weeks; 13..365 is days. */
function interpretBareNumber(value: number): number | null {
  const n = wholeNumber(value);
  if (n === null || n <= 0) return null;
  if (n <= 12) return fromWeeks(n);
  return clampDays(n);
}

function normalizePhrase(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ');
}

const NAMED: [RegExp, number][] = [
  [/^(fortnightly|fortnight)$/, 14],
  [/^(two|2)\s+weekly$/, 14],
  [/^weekly$/, 7],
  [/^monthly$/, 28],
  [/^quarterly$/, 91],
  [/^twice\s+(yearly|annual|annually|a\s+year)$/, 182],
  [/^(6|six)\s+monthly$/, 182],
  [/^(yearly|annually|annual|year)$/, 365],
];

const NUMERIC: [RegExp, (n: number) => number | null][] = [
  [/^(\d+)\s*weekly$/, fromWeeks],
  [/^(\d+)\s*weeks?$/, fromWeeks],
  [/^(\d+)\s*w$/, fromWeeks],
  [/^(\d+)\s*days?$/, clampDays],
  [/^(\d+)\s*d$/, clampDays],
  [/^(\d+)\s*months?$/, fromMonths],
  [/^(\d+)\s*m$/, fromMonths],
  [/^(\d+)$/, interpretBareNumber],
];

/**
 * "4 weekly", "every 4 weeks", "4-weekly", "fortnightly", "monthly", "28",
 * "28 days", "6w" → days. null when unreadable.
 */
export function parseFrequencyDays(
  raw: string | number | null | undefined,
): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return interpretBareNumber(raw);

  const phrase = normalizePhrase(raw);
  if (!phrase) return null;

  const stripped = phrase.replace(/^every\s+/, '');

  for (const [pattern, days] of NAMED) {
    if (pattern.test(stripped)) return days;
  }

  for (const [pattern, interpret] of NUMERIC) {
    const match = pattern.exec(stripped);
    if (match) return interpret(Number(match[1]));
  }

  return null;
}

export function frequencyLabel(days: number): string {
  if (days === 7) return 'Weekly';
  if (days === 14) return 'Fortnightly';
  if (days === 91) return 'Quarterly';
  if (days === 182) return 'Twice yearly';
  if (days === 365) return 'Yearly';
  if (days % 7 === 0) {
    const weeks = days / 7;
    return weeks === 1 ? 'Weekly' : `Every ${weeks} weeks`;
  }
  return `Every ${days} days`;
}

/** A month on the wheels is 4 weeks, so 1 month and 2 weeks is 6 weeks. */
export function frequencyParts(days: number): { months: number; weeks: number } {
  const totalWeeks = Math.min(51, Math.max(1, Math.round(days / 7)));
  const months = Math.min(12, Math.floor(totalWeeks / 4));
  const weeks = totalWeeks - months * 4;
  return { months, weeks: weeks > 3 ? 3 : weeks };
}

export function frequencyDaysFromParts(months: number, weeks: number): number {
  const safeMonths = Math.min(12, Math.max(0, months));
  const safeWeeks = Math.min(3, Math.max(0, weeks));
  return Math.max(7, safeMonths * 28 + safeWeeks * 7);
}

export const FREQUENCY_PRESETS: { days: number; label: string }[] = [
  7, 14, 21, 28, 42, 56, 84, 91, 182, 365,
].map((days) => ({ days, label: frequencyLabel(days) }));
