import { describe, expect, it } from 'vitest';
import {
  addDays,
  compareYmd,
  diffDays,
  endOfMonth,
  isoWeekday,
  isValidYmd,
  startOfMonth,
  todayInLondon,
  ymdFromDate,
} from '@/lib/rounds/dates';

describe('isValidYmd', () => {
  it('accepts real calendar days', () => {
    expect(isValidYmd('2026-09-15')).toBe(true);
    expect(isValidYmd('2024-02-29')).toBe(true);
  });

  it('rejects non-dates and impossible days', () => {
    expect(isValidYmd('2026-09-15T00:00:00Z')).toBe(false);
    expect(isValidYmd('15/09/2026')).toBe(false);
    expect(isValidYmd('2026-13-01')).toBe(false);
    expect(isValidYmd('2025-02-29')).toBe(false);
    expect(isValidYmd('2026-04-31')).toBe(false);
    expect(isValidYmd(null)).toBe(false);
    expect(isValidYmd(20260915)).toBe(false);
  });
});

describe('todayInLondon', () => {
  it('uses the London calendar date, not UTC, around midnight in summer', () => {
    // 15 Jun 2026 23:30 UTC is 16 Jun 00:30 BST.
    expect(todayInLondon(new Date('2026-06-15T23:30:00.000Z'))).toBe('2026-06-16');
  });

  it('stays on the UTC day in winter when London is GMT', () => {
    expect(todayInLondon(new Date('2026-01-15T23:30:00.000Z'))).toBe('2026-01-15');
  });
});

describe('addDays / diffDays', () => {
  it('adds whole days with UTC arithmetic across month and year', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-09-15', -3)).toBe('2026-09-12');
  });

  it('does not skip or double a day around UK DST', () => {
    // Clocks forward 29 Mar 2026; UTC day arithmetic must still be 1 calendar day.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(diffDays('2026-03-28', '2026-03-30')).toBe(2);
  });

  it('handles leap day', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01');
  });

  it('diffDays is to minus from in whole days', () => {
    expect(diffDays('2026-09-15', '2026-09-15')).toBe(0);
    expect(diffDays('2026-09-15', '2026-09-22')).toBe(7);
    expect(diffDays('2026-09-22', '2026-09-15')).toBe(-7);
  });
});

describe('isoWeekday', () => {
  it('uses ISO numbers: 1 Monday … 7 Sunday', () => {
    expect(isoWeekday('2026-09-14')).toBe(1); // Monday
    expect(isoWeekday('2026-09-15')).toBe(2); // Tuesday
    expect(isoWeekday('2026-09-18')).toBe(5); // Friday
    expect(isoWeekday('2026-09-20')).toBe(7); // Sunday
  });
});

describe('compareYmd / month bounds / ymdFromDate', () => {
  it('compares as dates', () => {
    expect(compareYmd('2026-09-14', '2026-09-15')).toBeLessThan(0);
    expect(compareYmd('2026-09-15', '2026-09-15')).toBe(0);
    expect(compareYmd('2026-09-16', '2026-09-15')).toBeGreaterThan(0);
  });

  it('start and end of month, including February', () => {
    expect(startOfMonth('2026-09-15')).toBe('2026-09-01');
    expect(endOfMonth('2026-09-15')).toBe('2026-09-30');
    expect(endOfMonth('2024-02-10')).toBe('2024-02-29');
    expect(endOfMonth('2025-02-10')).toBe('2025-02-28');
  });

  it('ymdFromDate uses UTC getters', () => {
    expect(ymdFromDate(new Date('2026-09-15T23:30:00.000Z'))).toBe('2026-09-15');
  });
});
