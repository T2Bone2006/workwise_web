import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  type ExpenseCategory,
} from '@/lib/books/categories';
import { londonDateOf, monthsInTaxYear, periodRange, type PeriodRange } from '@/lib/books/periods';
import { fromPence, toPence } from '@/lib/money/pence';
import type { Ymd } from '@/lib/rounds/dates';

export type PaymentIn = { receivedAt: string; amount: number; refundedAmount: number; method: string };
export type ExpenseOut = {
  spentOn: Ymd;
  amount: number;
  vatAmount: number | null;
  category: ExpenseCategory;
};

export type BooksSummary = {
  period: PeriodRange;
  moneyIn: number; // sum(amount − refunded), pounds 2dp
  paymentsCount: number;
  moneyInByMethod: Array<{ method: string; amount: number }>; // non-zero only, largest first
  moneyOut: number;
  /** All nine, in EXPENSE_CATEGORIES order, zeros included. */
  moneyOutByCategory: Array<{
    category: ExpenseCategory;
    label: string;
    amount: number;
    vatAmount: number;
    count: number;
  }>;
  left: number; // moneyIn − moneyOut (may be negative)
  vat: null | { rate: number; vatInEstimate: number; vatOut: number }; // null when not VAT registered
  /** Tax-year periods only: 12 rows, April → March. */
  months?: Array<{ year: number; month: number; label: string; moneyIn: number; moneyOut: number }>;
};

/** The money counted from one payment, in pence: what was paid less what was refunded, never below zero. */
function countedPence(p: PaymentIn): number {
  return Math.max(0, toPence(p.amount) - toPence(p.refundedAmount));
}

function inRange(date: Ymd, range: PeriodRange): boolean {
  return date >= range.from && date <= range.to;
}

function isTaxYearRange(range: PeriodRange): boolean {
  return range.from.slice(5) === '04-06' && range.to.slice(5) === '04-05';
}

/**
 * Cash basis (D5): money in by the London day it arrived, money out by the day
 * it was spent. All maths in pence so 0.1 + 0.2 is 0.30. Callers pass only
 * active payments and confirmed expenses; the date filter here is a second guard.
 */
export function summarise(p: {
  period: PeriodRange;
  payments: PaymentIn[];
  expenses: ExpenseOut[];
  vat: { registered: boolean; ratePercent: number };
  withMonths: boolean;
}): BooksSummary {
  const { period } = p;

  const payments = p.payments
    .map((pay) => ({ ...pay, day: londonDateOf(pay.receivedAt), pence: countedPence(pay) }))
    .filter((pay) => inRange(pay.day, period));
  const counted = payments.filter((pay) => pay.pence > 0);

  const expenses = p.expenses.filter((e) => inRange(e.spentOn, period));

  const moneyInPence = counted.reduce((sum, pay) => sum + pay.pence, 0);
  const moneyOutPence = expenses.reduce((sum, e) => sum + toPence(e.amount), 0);

  const byMethod = new Map<string, number>();
  for (const pay of counted) byMethod.set(pay.method, (byMethod.get(pay.method) ?? 0) + pay.pence);
  const moneyInByMethod = [...byMethod.entries()]
    .map(([method, pence]) => ({ method, amount: fromPence(pence) }))
    .sort((a, b) => b.amount - a.amount || a.method.localeCompare(b.method));

  const moneyOutByCategory = EXPENSE_CATEGORIES.map((category) => {
    const rows = expenses.filter((e) => e.category === category);
    return {
      category,
      label: EXPENSE_CATEGORY_LABELS[category],
      amount: fromPence(rows.reduce((sum, e) => sum + toPence(e.amount), 0)),
      vatAmount: fromPence(rows.reduce((sum, e) => sum + toPence(e.vatAmount ?? 0), 0)),
      count: rows.length,
    };
  });

  const vat = p.vat.registered
    ? {
        rate: p.vat.ratePercent,
        // income × rate ÷ (100 + rate): the VAT inside a VAT-inclusive total.
        vatInEstimate: fromPence(Math.round((moneyInPence * p.vat.ratePercent) / (100 + p.vat.ratePercent))),
        vatOut: fromPence(expenses.reduce((sum, e) => sum + toPence(e.vatAmount ?? 0), 0)),
      }
    : null;

  const summary: BooksSummary = {
    period,
    moneyIn: fromPence(moneyInPence),
    paymentsCount: counted.length,
    moneyInByMethod,
    moneyOut: fromPence(moneyOutPence),
    moneyOutByCategory,
    left: fromPence(moneyInPence - moneyOutPence),
    vat,
  };

  if (p.withMonths && isTaxYearRange(period)) {
    const startYear = Number(period.from.slice(0, 4));
    const rows = monthsInTaxYear(startYear);
    const lastIndex = rows.length - 1;
    // Rows are calendar months. 1–5 April of the closing year belongs to the tax
    // year but has no April row of its own, so it joins the March row — that keeps
    // the 12 rows adding up to the totals exactly.
    const rowIndexOf = (day: Ymd): number => {
      const year = Number(day.slice(0, 4));
      const month = Number(day.slice(5, 7));
      const index = rows.findIndex((r) => r.year === year && r.month === month);
      return index === -1 ? lastIndex : index;
    };
    const inPence = new Array<number>(rows.length).fill(0);
    const outPence = new Array<number>(rows.length).fill(0);
    for (const pay of counted) inPence[rowIndexOf(pay.day)] += pay.pence;
    for (const e of expenses) outPence[rowIndexOf(e.spentOn)] += toPence(e.amount);
    summary.months = rows.map((r, i) => ({
      year: r.year,
      month: r.month,
      label: periodRange({ kind: 'month', year: r.year, month: r.month }).label,
      moneyIn: fromPence(inPence[i]),
      moneyOut: fromPence(outPence[i]),
    }));
  }

  return summary;
}
