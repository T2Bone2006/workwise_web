import { EXPENSE_CATEGORY_HMRC, type ExpenseCategory } from '@/lib/books/categories';
import type { BooksSummary } from '@/lib/books/summary-pure';
import { fromPence, toPence } from '@/lib/money/pence';

export type HmrcHeadingRow = {
  heading: string;
  /** The WorkWise categories that fall under this heading, in their usual order. */
  categories: string[];
  amount: number;
  vatAmount: number;
  count: number;
};

/**
 * Money out grouped the way the accountant files it: by HMRC heading, not by
 * WorkWise category. Two categories can share a heading (Equipment & tools and
 * Other both go under "Other allowable business expenses"). Headings with
 * nothing spent are dropped, and the rest are largest first.
 */
export function groupByHmrcHeading(rows: BooksSummary['moneyOutByCategory']): HmrcHeadingRow[] {
  const byHeading = new Map<string, { categories: string[]; amount: number; vat: number; count: number }>();
  for (const row of rows) {
    if (row.count === 0) continue;
    const heading = EXPENSE_CATEGORY_HMRC[row.category as ExpenseCategory];
    const entry = byHeading.get(heading) ?? { categories: [], amount: 0, vat: 0, count: 0 };
    entry.categories.push(row.label);
    entry.amount += toPence(row.amount);
    entry.vat += toPence(row.vatAmount);
    entry.count += row.count;
    byHeading.set(heading, entry);
  }
  return [...byHeading.entries()]
    .map(([heading, e]) => ({
      heading,
      categories: e.categories,
      amount: fromPence(e.amount),
      vatAmount: fromPence(e.vat),
      count: e.count,
    }))
    .sort((a, b) => b.amount - a.amount || a.heading.localeCompare(b.heading));
}
