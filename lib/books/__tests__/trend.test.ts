import { describe, expect, it } from 'vitest';
import { buildTrend, lastMonthToDate, trendMonthKeys } from '@/lib/books/trend';

describe('trendMonthKeys', () => {
  it('counts back across a year end, oldest first', () => {
    expect(trendMonthKeys('2026-02-14', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(trendMonthKeys('2026-10-01', 1)).toEqual(['2026-10']);
  });
});

describe('buildTrend', () => {
  it('adds money in less refunds, and saved expenses, per month', () => {
    const t = buildTrend({
      keys: ['2026-09', '2026-10'],
      payments: [
        { date: '2026-09-03', amount: 15, refunded: 0 },
        { date: '2026-09-20', amount: 30.1, refunded: 10 },
        { date: '2026-10-01', amount: 20, refunded: 25 }, // refunded beyond the payment counts as 0
        { date: '2026-08-31', amount: 99, refunded: 0 }, // outside the window
      ],
      expenses: [
        { date: '2026-10-01', amount: 12.5 },
        { date: '2026-10-02', amount: 0.2 },
      ],
    });
    expect(t).toEqual([
      { key: '2026-09', label: 'Sep', moneyIn: 35.1, moneyOut: 0 },
      { key: '2026-10', label: 'Oct', moneyIn: 0, moneyOut: 12.7 },
    ]);
  });
});

describe('lastMonthToDate', () => {
  const payments = [
    { date: '2026-09-01', amount: 10, refunded: 0 },
    { date: '2026-09-15', amount: 20, refunded: 5 },
    { date: '2026-09-16', amount: 40, refunded: 0 },
    { date: '2026-10-01', amount: 99, refunded: 0 },
  ];
  it('adds last month up to the same day', () => {
    expect(lastMonthToDate(payments, '2026-10-15')).toBe(25);
    expect(lastMonthToDate(payments, '2026-10-01')).toBe(10);
  });
  it('stops at the end of a shorter month', () => {
    expect(lastMonthToDate([{ date: '2026-02-28', amount: 5, refunded: 0 }], '2026-03-31')).toBe(5);
  });
});
