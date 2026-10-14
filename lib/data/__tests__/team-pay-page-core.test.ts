import { describe, expect, it } from 'vitest';
import { owedFigure, parsePayPeriod, payRange, payTotals, visiblePeople } from '../team-pay-page-core';

describe('parsePayPeriod', () => {
  it('defaults to this week and ignores rubbish', () => {
    expect(parsePayPeriod(undefined)).toBe('week');
    expect(parsePayPeriod('banana')).toBe('week');
    expect(parsePayPeriod('month')).toBe('month');
    expect(parsePayPeriod(['all', 'month'])).toBe('all');
  });
});

describe('payRange', () => {
  it('week runs Monday to Sunday', () => {
    // Wed 14 Oct 2026
    expect(payRange('week', '2026-10-14').range).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    // a Sunday still belongs to the week that began on Monday
    expect(payRange('week', '2026-10-18').range).toEqual({ from: '2026-10-12', to: '2026-10-18' });
  });
  it('month and tax year', () => {
    expect(payRange('month', '2026-10-14').range).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(payRange('tax-year', '2026-10-14').range).toEqual({ from: '2026-04-06', to: '2027-04-05' });
    expect(payRange('tax-year', '2027-03-01').range).toEqual({ from: '2026-04-06', to: '2027-04-05' });
  });
  it('all time has no limits', () => {
    expect(payRange('all', '2026-10-14').range).toEqual({});
  });
});

describe('payTotals', () => {
  it('sums earned and paid; owed counts only what is still owed', () => {
    const t = payTotals([
      { earnedPence: 48000, paidPence: 30000, owedPence: 18000 },
      { earnedPence: 27000, paidPence: 27000, owedPence: 0 },
      { earnedPence: 9000, paidPence: 11000, owedPence: -2000 },
    ]);
    expect(t).toEqual({ earnedPence: 84000, paidPence: 68000, owedPence: 18000, aheadPence: 2000 });
  });
});

describe('visiblePeople', () => {
  it('keeps active people at zero and hides removed people with nothing in the period', () => {
    const zero = { daysWorked: 0, earnedPence: 0, paidPence: 0, owedPence: 0 };
    const out = visiblePeople([
      { id: 'a', active: true, ...zero },
      { id: 'b', active: false, ...zero },
      { id: 'c', active: false, ...zero, paidPence: 100, owedPence: -100 },
    ]);
    expect(out.map((p) => p.id)).toEqual(['a', 'c']);
  });
});

describe('owedFigure', () => {
  it('rose when owed, amber when ahead, emerald when paid up, slate when nothing', () => {
    expect(owedFigure({ earnedPence: 100, paidPence: 0, owedPence: 100 })).toEqual({ tone: 'rose', kind: 'owed', pence: 100 });
    expect(owedFigure({ earnedPence: 100, paidPence: 150, owedPence: -50 })).toEqual({ tone: 'amber', kind: 'ahead', pence: 50 });
    expect(owedFigure({ earnedPence: 100, paidPence: 100, owedPence: 0 })).toMatchObject({ tone: 'emerald', kind: 'paid_up' });
    expect(owedFigure({ earnedPence: 0, paidPence: 0, owedPence: 0 })).toMatchObject({ tone: 'slate', kind: 'nothing' });
  });
});
