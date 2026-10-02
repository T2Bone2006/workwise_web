import { describe, expect, it } from 'vitest';
import {
  currentMonth,
  currentTaxYear,
  londonDateOf,
  monthsInTaxYear,
  parsePeriodParam,
  periodParam,
  periodRange,
  taxYearFor,
} from '@/lib/books/periods';

describe('taxYearFor', () => {
  it('switches on 6 April', () => {
    expect(taxYearFor('2026-04-05')).toBe(2025);
    expect(taxYearFor('2026-04-06')).toBe(2026);
    expect(taxYearFor('2027-04-05')).toBe(2026);
    expect(taxYearFor('2027-04-06')).toBe(2027);
    expect(taxYearFor('2027-01-01')).toBe(2026);
    expect(taxYearFor('2026-12-31')).toBe(2026);
  });
});

describe('periodRange', () => {
  it('gives the tax year edges and label', () => {
    expect(periodRange({ kind: 'tax_year', startYear: 2026 })).toEqual({
      from: '2026-04-06',
      to: '2027-04-05',
      label: '2026/27 tax year',
    });
  });

  it('labels the century turn', () => {
    expect(periodRange({ kind: 'tax_year', startYear: 2099 }).label).toBe('2099/00 tax year');
  });

  it('gives a month range and label', () => {
    expect(periodRange({ kind: 'month', year: 2027, month: 3 })).toEqual({
      from: '2027-03-01',
      to: '2027-03-31',
      label: 'March 2027',
    });
  });

  it('ends February on the 29th in a leap year', () => {
    expect(periodRange({ kind: 'month', year: 2028, month: 2 }).to).toBe('2028-02-29');
    expect(periodRange({ kind: 'month', year: 2027, month: 2 }).to).toBe('2027-02-28');
  });
});

describe('monthsInTaxYear', () => {
  it('runs April to March', () => {
    const months = monthsInTaxYear(2026);
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ year: 2026, month: 4 });
    expect(months[8]).toEqual({ year: 2026, month: 12 });
    expect(months[9]).toEqual({ year: 2027, month: 1 });
    expect(months[11]).toEqual({ year: 2027, month: 3 });
  });
});

describe('current period', () => {
  it('takes today from the argument', () => {
    expect(currentMonth('2026-10-01')).toEqual({ kind: 'month', year: 2026, month: 10 });
    expect(currentTaxYear('2026-10-01')).toEqual({ kind: 'tax_year', startYear: 2026 });
    expect(currentTaxYear('2027-02-10')).toEqual({ kind: 'tax_year', startYear: 2026 });
  });
});

describe('parsePeriodParam / periodParam', () => {
  const today = '2026-10-01';
  const fallback = { kind: 'month', year: 2026, month: 10 };

  it('reads months and tax years', () => {
    expect(parsePeriodParam('m-2027-03', today)).toEqual({ kind: 'month', year: 2027, month: 3 });
    expect(parsePeriodParam('ty-2026', today)).toEqual({ kind: 'tax_year', startYear: 2026 });
  });

  it('falls back to this month and never throws', () => {
    for (const bad of ['m-2027-13', 'm-2027-00', 'ty-abc', 'ty-26', 'm-2027-3', '', undefined, 'nonsense']) {
      expect(parsePeriodParam(bad, today)).toEqual(fallback);
    }
  });

  it('round-trips', () => {
    for (const p of [
      { kind: 'month', year: 2027, month: 3 },
      { kind: 'tax_year', startYear: 2026 },
    ] as const) {
      expect(parsePeriodParam(periodParam(p), today)).toEqual(p);
    }
    expect(periodParam({ kind: 'month', year: 2026, month: 4 })).toBe('m-2026-04');
  });
});

describe('londonDateOf', () => {
  it('uses summer time', () => {
    expect(londonDateOf('2026-10-24T23:30:00Z')).toBe('2026-10-25');
  });

  it('uses winter time', () => {
    expect(londonDateOf('2026-12-31T23:30:00Z')).toBe('2026-12-31');
  });
});
