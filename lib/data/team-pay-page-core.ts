import { periodRange, taxYearFor } from '@/lib/books/periods';
import { addDays, endOfMonth, isoWeekday, startOfMonth, type Ymd } from '@/lib/rounds/dates';
import type { PayRange, PersonPay } from '@/lib/team/pay';

export type PayPeriodKey = 'week' | 'month' | 'tax-year' | 'all';

export const PAY_PERIODS: Array<{ key: PayPeriodKey; label: string }> = [
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'tax-year', label: 'Tax year' },
  { key: 'all', label: 'All time' },
];

/** The period from the URL; anything unknown is this week. */
export function parsePayPeriod(raw: string | string[] | undefined): PayPeriodKey {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === 'month' || value === 'tax-year' || value === 'all' ? value : 'week';
}

/** The dates a period covers (inclusive, London days), and a plain label. 'all' has no limits. */
export function payRange(key: PayPeriodKey, today: Ymd): { range: PayRange; label: string } {
  if (key === 'all') return { range: {}, label: 'All time' };
  if (key === 'month') {
    const from = startOfMonth(today);
    return { range: { from, to: endOfMonth(from) }, label: 'This month' };
  }
  if (key === 'tax-year') {
    const r = periodRange({ kind: 'tax_year', startYear: taxYearFor(today) });
    return { range: { from: r.from, to: r.to }, label: `${r.label}` };
  }
  const from = addDays(today, -(isoWeekday(today) - 1));
  return { range: { from, to: addDays(from, 6) }, label: 'This week' };
}

export type PayTotals = { earnedPence: number; paidPence: number; owedPence: number; aheadPence: number };

/** Earned and paid add up as they are. Owed counts only what you still owe; paying someone ahead does not cancel it. */
export function payTotals(people: ReadonlyArray<Pick<PersonPay, 'earnedPence' | 'paidPence' | 'owedPence'>>): PayTotals {
  return people.reduce<PayTotals>(
    (sum, p) => ({
      earnedPence: sum.earnedPence + p.earnedPence,
      paidPence: sum.paidPence + p.paidPence,
      owedPence: sum.owedPence + Math.max(0, p.owedPence),
      aheadPence: sum.aheadPence + Math.max(0, -p.owedPence),
    }),
    { earnedPence: 0, paidPence: 0, owedPence: 0, aheadPence: 0 },
  );
}

/** Active people always appear (even at £0); a removed person only while the period has days or payments for them. */
export function visiblePeople<T extends Pick<PersonPay, 'active' | 'daysWorked' | 'earnedPence' | 'paidPence' | 'owedPence'>>(people: ReadonlyArray<T>): T[] {
  return people.filter((p) => p.active || p.daysWorked > 0 || p.earnedPence !== 0 || p.paidPence !== 0 || p.owedPence !== 0);
}

export type OwedTone = 'rose' | 'emerald' | 'amber' | 'slate';

/** What the big figure on a person's row says and which tone it takes. */
export function owedFigure(p: Pick<PersonPay, 'earnedPence' | 'paidPence' | 'owedPence'>): { tone: OwedTone; kind: 'owed' | 'paid_up' | 'ahead' | 'nothing'; pence: number } {
  if (p.owedPence > 0) return { tone: 'rose', kind: 'owed', pence: p.owedPence };
  if (p.owedPence < 0) return { tone: 'amber', kind: 'ahead', pence: -p.owedPence };
  if (p.earnedPence === 0 && p.paidPence === 0) return { tone: 'slate', kind: 'nothing', pence: 0 };
  return { tone: 'emerald', kind: 'paid_up', pence: 0 };
}

import type { DayRow, PaymentRow } from '@/lib/team/pay';

export type TeamPayRow = PersonPay & { dayRatePence: number };
export type TeamPayStatement = { person: TeamPayRow; days: DayRow[]; payments: PaymentRow[] };
export type TeamPayPageData = {
  periodKey: PayPeriodKey;
  label: string;
  rows: TeamPayRow[];
  totals: PayTotals;
  statement: TeamPayStatement | null;
  today: Ymd;
};
