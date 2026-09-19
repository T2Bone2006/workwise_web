import { isValidYmd, type Ymd } from './dates';

export type RoundsSettings = {
  horizon_weeks: number;
  reminder_days_before: number;
  working_days: number[];
  blackouts: Ymd[];
  shift_off_non_working_days: boolean;
  start_postcode: string | null;
};

export const DEFAULT_ROUNDS_SETTINGS: RoundsSettings = {
  horizon_weeks: 8,
  reminder_days_before: 3,
  working_days: [1, 2, 3, 4, 5],
  blackouts: [],
  shift_off_non_working_days: false,
  start_postcode: null,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isInteger(n)) return n;
  }
  return null;
}

function parseHorizonWeeks(raw: unknown): number {
  const n = asInteger(raw);
  if (n == null || n < 1 || n > 12) return DEFAULT_ROUNDS_SETTINGS.horizon_weeks;
  return n;
}

function parseReminderDays(raw: unknown): number {
  const n = asInteger(raw);
  if (n == null || n < 0 || n > 14) return DEFAULT_ROUNDS_SETTINGS.reminder_days_before;
  return n;
}

function parseWorkingDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [...DEFAULT_ROUNDS_SETTINGS.working_days];
  const days = new Set<number>();
  for (const item of raw) {
    const n = asInteger(item);
    if (n != null && n >= 1 && n <= 7) days.add(n);
  }
  if (days.size === 0) return [...DEFAULT_ROUNDS_SETTINGS.working_days];
  return [...days].sort((a, b) => a - b);
}

function parseBlackouts(raw: unknown): Ymd[] {
  if (!Array.isArray(raw)) return [];
  const dates = new Set<Ymd>();
  for (const item of raw) {
    if (isValidYmd(item)) dates.add(item);
  }
  return [...dates].sort();
}

function parseStartPostcode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

function parseShiftOffNonWorkingDays(raw: unknown): boolean {
  if (raw === true || raw === 1 || raw === 'true') return true;
  if (raw === false || raw === 0 || raw === 'false') return false;
  return DEFAULT_ROUNDS_SETTINGS.shift_off_non_working_days;
}

/** Write `settings.rounds` without touching any other tenant settings keys. */
export function withRoundsSettings(
  tenantSettings: unknown,
  rounds: RoundsSettings,
): Record<string, unknown> {
  const current = isPlainObject(tenantSettings) ? { ...tenantSettings } : {};
  return { ...current, rounds };
}

/** Tolerant: any missing/invalid field falls back to its default. */
export function parseRoundsSettings(raw: unknown): RoundsSettings {
  const source = isPlainObject(raw) ? raw : {};
  return {
    horizon_weeks: parseHorizonWeeks(source.horizon_weeks),
    reminder_days_before: parseReminderDays(source.reminder_days_before),
    working_days: parseWorkingDays(source.working_days),
    blackouts: parseBlackouts(source.blackouts),
    shift_off_non_working_days: parseShiftOffNonWorkingDays(source.shift_off_non_working_days),
    start_postcode: parseStartPostcode(source.start_postcode),
  };
}
