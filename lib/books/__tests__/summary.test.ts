import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadBooksSummary } from '@/lib/books/summary';

type Row = Record<string, unknown>;

/** Stand-in database: serves paged reads for payments and expenses, and one settings row. */
function fakeDb(opts: { payments?: Row[]; expenses?: Row[]; settings?: Row | null; failOn?: string }) {
  const log: Array<{ table: string; filters: Array<[string, unknown]>; range?: [number, number] }> = [];
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    let range: [number, number] | undefined;
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'order']) b[m] = () => b;
    for (const m of ['eq', 'gte', 'lt', 'lte']) {
      b[m] = (k: string, v: unknown) => {
        filters.push([k, v]);
        return b;
      };
    }
    b.range = (a: number, z: number) => {
      range = [a, z];
      log.push({ table, filters, range });
      if (opts.failOn === table) return Promise.resolve({ data: null, error: { message: 'boom' } });
      const all = (table === 'payments' ? opts.payments : opts.expenses) ?? [];
      return Promise.resolve({ data: all.slice(a, z + 1), error: null });
    };
    b.maybeSingle = async () =>
      opts.failOn === table
        ? { data: null, error: { message: 'boom' } }
        : { data: opts.settings ?? null, error: null };
    return b;
  };
  return { db: { from } as unknown as SupabaseClient, log };
}

const octoberPayment = (i: number): Row => ({
  amount: 10, refunded_amount: 0, received_at: '2026-10-15T10:00:00Z', method: 'cash', id: String(i),
});

describe('loadBooksSummary', () => {
  it('reads every page, so more than 1,000 payments are all counted', async () => {
    const payments = Array.from({ length: 2300 }, (_, i) => octoberPayment(i));
    const { db, log } = fakeDb({ payments });
    const s = await loadBooksSummary(db, { tenantId: 't1', period: { kind: 'month', year: 2026, month: 10 } });
    expect(s.paymentsCount).toBe(2300);
    expect(s.moneyIn).toBe(23000);
    expect(log.filter((l) => l.table === 'payments').map((l) => l.range)).toEqual([
      [0, 999], [1000, 1999], [2000, 2999],
    ]);
  });

  it('filters by this business, active payments and confirmed expenses', async () => {
    const { db, log } = fakeDb({ payments: [octoberPayment(1)] });
    await loadBooksSummary(db, { tenantId: 't1', period: { kind: 'month', year: 2026, month: 10 } });
    const payments = log.find((l) => l.table === 'payments')!;
    expect(payments.filters).toContainEqual(['tenant_id', 't1']);
    expect(payments.filters).toContainEqual(['status', 'active']);
    const expenses = log.find((l) => l.table === 'expenses')!;
    expect(expenses.filters).toContainEqual(['tenant_id', 't1']);
    expect(expenses.filters).toContainEqual(['status', 'confirmed']);
  });

  it('bounds payments by London days (BST: 1 Oct starts 30 Sep 23:00 UTC)', async () => {
    const { db, log } = fakeDb({});
    await loadBooksSummary(db, { tenantId: 't1', period: { kind: 'month', year: 2026, month: 10 } });
    const filters = log.find((l) => l.table === 'payments')!.filters;
    expect(filters).toContainEqual(['received_at', '2026-09-30T23:00:00.000Z']);
    // 31 Oct 2026 is still BST; the clocks go back on the 25th, so midnight 1 Nov is 00:00 UTC.
    expect(filters).toContainEqual(['received_at', '2026-11-01T00:00:00.000Z']);
  });

  it('treats a missing settings row as not VAT registered, and reads the rate when registered', async () => {
    const period = { kind: 'month', year: 2026, month: 10 } as const;
    expect((await loadBooksSummary(fakeDb({}).db, { tenantId: 't1', period })).vat).toBeNull();
    const registered = fakeDb({
      payments: [octoberPayment(1)],
      settings: { vat_registered: true, vat_rate_percent: '20' },
    });
    expect((await loadBooksSummary(registered.db, { tenantId: 't1', period })).vat).toMatchObject({
      rate: 20, vatInEstimate: 1.67,
    });
  });

  it('skips an expense with a category the app does not know instead of miscounting it', async () => {
    const { db } = fakeDb({
      expenses: [
        { spent_on: '2026-10-02', amount: 5, vat_amount: null, category: 'vehicle', id: 'a' },
        { spent_on: '2026-10-02', amount: 7, vat_amount: null, category: 'fuel', id: 'b' },
      ],
    });
    const s = await loadBooksSummary(db, { tenantId: 't1', period: { kind: 'month', year: 2026, month: 10 } });
    expect(s.moneyOut).toBe(5);
  });

  it('throws on any read error rather than return partial numbers', async () => {
    const period = { kind: 'month', year: 2026, month: 10 } as const;
    for (const failOn of ['payments', 'expenses', 'tenant_payment_settings']) {
      await expect(loadBooksSummary(fakeDb({ failOn }).db, { tenantId: 't1', period })).rejects.toThrow(
        'Could not load the books',
      );
    }
  });

  it('gives 12 month rows for a tax year', async () => {
    const { db } = fakeDb({});
    const s = await loadBooksSummary(db, { tenantId: 't1', period: { kind: 'tax_year', startYear: 2026 } });
    expect(s.months).toHaveLength(12);
  });
});
