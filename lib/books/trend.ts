import { fromPence, toPence } from '@/lib/money/pence';

/*
 * Money in and out per month for the last few months, for the overview chart.
 * Same rules as In & out (summary-pure.ts): cash basis, money in is what
 * arrived less refunds, money out is saved expenses.
 */

export type TrendMonth = { key: string; label: string; moneyIn: number; moneyOut: number };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM' for the `count` months ending with the month `today` is in, oldest first. */
export function trendMonthKeys(today: string, count: number): string[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return Array.from({ length: count }, (_, i) => {
    const offset = month - 1 - (count - 1 - i);
    const y = year + Math.floor(offset / 12);
    const m = ((offset % 12) + 12) % 12;
    return `${y}-${String(m + 1).padStart(2, '0')}`;
  });
}

export function buildTrend(p: {
  keys: string[];
  /** London date each payment arrived, with its amounts. */
  payments: Array<{ date: string; amount: number; refunded: number }>;
  expenses: Array<{ date: string; amount: number }>;
}): TrendMonth[] {
  const inPence = new Map<string, number>();
  const outPence = new Map<string, number>();
  for (const pay of p.payments) {
    const key = pay.date.slice(0, 7);
    inPence.set(key, (inPence.get(key) ?? 0) + Math.max(0, toPence(pay.amount) - toPence(pay.refunded)));
  }
  for (const exp of p.expenses) {
    const key = exp.date.slice(0, 7);
    outPence.set(key, (outPence.get(key) ?? 0) + toPence(exp.amount));
  }
  return p.keys.map((key) => ({
    key,
    label: MONTHS[Number(key.slice(5, 7)) - 1]!,
    moneyIn: fromPence(inPence.get(key) ?? 0),
    moneyOut: fromPence(outPence.get(key) ?? 0),
  }));
}

/** Money in last month from its 1st up to the same day of the month as today (or its last day), for a fair "so far" comparison. */
export function lastMonthToDate(payments: Array<{ date: string; amount: number; refunded: number }>, today: string): number {
  const [prevKey] = trendMonthKeys(today, 2);
  const lastDay = new Date(Date.UTC(Number(prevKey!.slice(0, 4)), Number(prevKey!.slice(5, 7)), 0)).getUTCDate();
  const to = `${prevKey}-${String(Math.min(Number(today.slice(8, 10)), lastDay)).padStart(2, '0')}`;
  let pence = 0;
  for (const pay of payments) {
    if (pay.date >= `${prevKey}-01` && pay.date <= to) pence += Math.max(0, toPence(pay.amount) - toPence(pay.refunded));
  }
  return fromPence(pence);
}
