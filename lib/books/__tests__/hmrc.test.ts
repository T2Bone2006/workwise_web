import { describe, expect, it } from 'vitest';
import { groupByHmrcHeading } from '@/lib/books/hmrc';
import { summarise } from '@/lib/books/summary-pure';
import { periodRange } from '@/lib/books/periods';

const month = periodRange({ kind: 'month', year: 2026, month: 10 });

function rowsFor(expenses: Array<{ category: never; amount: number; vat?: number }>) {
  return summarise({
    period: month,
    payments: [],
    expenses: expenses.map((e) => ({ spentOn: '2026-10-05', amount: e.amount, vatAmount: e.vat ?? null, category: e.category })),
    vat: { registered: true, ratePercent: 20 },
    withMonths: false,
  }).moneyOutByCategory;
}

describe('per-category VAT in the summary', () => {
  it('adds up VAT per category, with a missing VAT counting as nothing', () => {
    const rows = rowsFor([
      { category: 'vehicle' as never, amount: 60, vat: 10 },
      { category: 'vehicle' as never, amount: 12, vat: 2 },
      { category: 'vehicle' as never, amount: 5 },
      { category: 'supplies' as never, amount: 24.99, vat: 4.17 },
    ]);
    expect(rows.find((r) => r.category === 'vehicle')).toMatchObject({ amount: 77, vatAmount: 12, count: 3 });
    expect(rows.find((r) => r.category === 'supplies')).toMatchObject({ amount: 24.99, vatAmount: 4.17 });
    expect(rows.find((r) => r.category === 'wages')).toMatchObject({ amount: 0, vatAmount: 0, count: 0 });
  });
});

describe('groupByHmrcHeading', () => {
  it('drops headings with nothing spent and puts the biggest first', () => {
    const grouped = groupByHmrcHeading(
      rowsFor([
        { category: 'supplies' as never, amount: 24.99, vat: 4.17 },
        { category: 'vehicle' as never, amount: 60, vat: 10 },
      ]),
    );
    expect(grouped.map((g) => g.heading)).toEqual([
      'Car, van and travel expenses',
      'Cost of goods bought for resale or goods used',
    ]);
    expect(grouped[0]).toMatchObject({ amount: 60, vatAmount: 10, count: 1, categories: ['Vehicle & fuel'] });
  });

  it('joins categories that share a heading', () => {
    const grouped = groupByHmrcHeading(
      rowsFor([
        { category: 'equipment' as never, amount: 100.1, vat: 16.68 },
        { category: 'other' as never, amount: 0.2 },
      ]),
    );
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toEqual({
      heading: 'Other allowable business expenses',
      categories: ['Equipment & tools', 'Other'],
      amount: 100.3,
      vatAmount: 16.68,
      count: 2,
    });
  });

  it('gives nothing for nothing', () => {
    expect(groupByHmrcHeading(rowsFor([]))).toEqual([]);
  });
});
