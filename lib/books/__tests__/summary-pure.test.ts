import { describe, expect, it } from 'vitest';
import { periodRange } from '@/lib/books/periods';
import { summarise, type ExpenseOut, type PaymentIn } from '@/lib/books/summary-pure';

const month = (year: number, m: number) => periodRange({ kind: 'month', year, month: m });
const taxYear = (startYear: number) => periodRange({ kind: 'tax_year', startYear });
const noVat = { registered: false, ratePercent: 20 };

const pay = (receivedAt: string, amount: number, over: Partial<PaymentIn> = {}): PaymentIn => ({
  receivedAt, amount, refundedAmount: 0, method: 'cash', ...over,
});
const exp = (spentOn: string, amount: number, over: Partial<ExpenseOut> = {}): ExpenseOut => ({
  spentOn, amount, vatAmount: null, category: 'vehicle', ...over,
});

describe('summarise', () => {
  it('adds in pence, so 0.1 + 0.2 is exactly 0.30', () => {
    const s = summarise({
      period: month(2026, 10),
      payments: [pay('2026-10-05T10:00:00Z', 0.1), pay('2026-10-06T10:00:00Z', 0.2)],
      expenses: [exp('2026-10-07', 0.1), exp('2026-10-08', 0.2)],
      vat: noVat, withMonths: false,
    });
    expect(s.moneyIn).toBe(0.3);
    expect(s.moneyOut).toBe(0.3);
    expect(s.left).toBe(0);
  });

  it('counts a part-refunded payment net and ignores a fully refunded one', () => {
    const s = summarise({
      period: month(2026, 10),
      payments: [
        pay('2026-10-05T10:00:00Z', 20, { refundedAmount: 5 }),
        pay('2026-10-06T10:00:00Z', 30, { refundedAmount: 30 }),
        pay('2026-10-07T10:00:00Z', 10),
      ],
      expenses: [], vat: noVat, withMonths: false,
    });
    expect(s.moneyIn).toBe(25);
    expect(s.paymentsCount).toBe(2);
  });

  it('puts a late-evening UTC payment on the next London day at a month edge', () => {
    // 23:30 UTC on 31 March 2027 is 00:30 BST on 1 April.
    const payments = [pay('2027-03-31T23:30:00Z', 40)];
    const march = summarise({ period: month(2027, 3), payments, expenses: [], vat: noVat, withMonths: false });
    const april = summarise({ period: month(2027, 4), payments, expenses: [], vat: noVat, withMonths: false });
    expect(march.moneyIn).toBe(0);
    expect(april.moneyIn).toBe(40);
  });

  it('only counts what falls inside the period', () => {
    const s = summarise({
      period: month(2026, 10),
      payments: [pay('2026-09-30T10:00:00Z', 99), pay('2026-10-15T10:00:00Z', 10), pay('2026-11-01T10:00:00Z', 99)],
      expenses: [exp('2026-09-30', 99), exp('2026-10-15', 4), exp('2026-11-01', 99)],
      vat: noVat, withMonths: false,
    });
    expect(s.moneyIn).toBe(10);
    expect(s.moneyOut).toBe(4);
  });

  it('breaks money in by method (largest first) and money out into all nine categories', () => {
    const s = summarise({
      period: month(2026, 10),
      payments: [
        pay('2026-10-01T10:00:00Z', 10, { method: 'cash' }),
        pay('2026-10-02T10:00:00Z', 50, { method: 'direct_debit' }),
        pay('2026-10-03T10:00:00Z', 20, { method: 'cash' }),
      ],
      expenses: [exp('2026-10-04', 12.5, { category: 'supplies' }), exp('2026-10-05', 7.5, { category: 'supplies' })],
      vat: noVat, withMonths: false,
    });
    expect(s.moneyInByMethod).toEqual([
      { method: 'direct_debit', amount: 50 },
      { method: 'cash', amount: 30 },
    ]);
    expect(s.moneyOutByCategory).toHaveLength(9);
    expect(s.moneyOutByCategory.map((c) => c.category)).toEqual([
      'vehicle', 'equipment', 'supplies', 'phone', 'insurance', 'advertising', 'fees', 'wages', 'other',
    ]);
    expect(s.moneyOutByCategory.find((c) => c.category === 'supplies')).toMatchObject({
      label: 'Cleaning supplies', amount: 20, count: 2,
    });
    expect(s.moneyOutByCategory.find((c) => c.category === 'wages')).toMatchObject({ amount: 0, count: 0 });
  });

  it('lets "left" go negative', () => {
    const s = summarise({
      period: month(2026, 10), payments: [pay('2026-10-05T10:00:00Z', 10)],
      expenses: [exp('2026-10-06', 25)], vat: noVat, withMonths: false,
    });
    expect(s.left).toBe(-15);
  });

  it('gives 12 months April → March for a tax year, adding up to the totals', () => {
    const s = summarise({
      period: taxYear(2026),
      payments: [
        pay('2026-04-06T09:00:00Z', 100), // first day
        pay('2026-12-15T09:00:00Z', 50),
        pay('2027-03-31T23:30:00Z', 25), // 1 April London = tail of the year
        pay('2027-04-05T09:00:00Z', 5), // last day
        pay('2027-04-06T09:00:00Z', 999), // next tax year: excluded
        pay('2026-04-05T09:00:00Z', 999), // previous tax year: excluded
      ],
      expenses: [exp('2026-04-30', 10), exp('2027-03-02', 3.33), exp('2027-04-02', 1.11)],
      vat: noVat, withMonths: true,
    });
    expect(s.months).toHaveLength(12);
    expect(s.months![0]).toMatchObject({ year: 2026, month: 4, label: 'April 2026', moneyIn: 100, moneyOut: 10 });
    expect(s.months![11]).toMatchObject({ year: 2027, month: 3, label: 'March 2027' });
    expect(s.months!.reduce((sum, m) => sum + Math.round(m.moneyIn * 100), 0)).toBe(Math.round(s.moneyIn * 100));
    expect(s.months!.reduce((sum, m) => sum + Math.round(m.moneyOut * 100), 0)).toBe(Math.round(s.moneyOut * 100));
    expect(s.moneyIn).toBe(180);
    expect(s.moneyOut).toBe(14.44);
  });

  it('only gives months for a tax year, and only when asked', () => {
    const args = { payments: [], expenses: [], vat: noVat };
    expect(summarise({ ...args, period: month(2026, 10), withMonths: true }).months).toBeUndefined();
    expect(summarise({ ...args, period: taxYear(2026), withMonths: false }).months).toBeUndefined();
  });

  it('has no VAT block when not registered, even if expenses carry VAT', () => {
    const s = summarise({
      period: month(2026, 10), payments: [pay('2026-10-05T10:00:00Z', 120)],
      expenses: [exp('2026-10-06', 60, { vatAmount: 10 })], vat: noVat, withMonths: false,
    });
    expect(s.vat).toBeNull();
  });

  it('estimates VAT in as income × rate ÷ (100 + rate), and adds up VAT out', () => {
    const s = summarise({
      period: month(2026, 10),
      payments: [pay('2026-10-05T10:00:00Z', 120)],
      expenses: [exp('2026-10-06', 60, { vatAmount: 10 }), exp('2026-10-07', 12, { vatAmount: 2 }), exp('2026-10-08', 5)],
      vat: { registered: true, ratePercent: 20 }, withMonths: false,
    });
    expect(s.vat).toEqual({ rate: 20, vatInEstimate: 20, vatOut: 12 });
  });

  it('uses the stored rate and rounds to the penny', () => {
    const s = summarise({
      period: month(2026, 10), payments: [pay('2026-10-05T10:00:00Z', 100)], expenses: [],
      vat: { registered: true, ratePercent: 5 }, withMonths: false,
    });
    expect(s.vat?.vatInEstimate).toBe(4.76); // 100 × 5 ÷ 105 = 4.7619…
  });
});
