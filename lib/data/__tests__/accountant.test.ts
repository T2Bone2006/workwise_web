import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  accountantEarliestTaxYear,
  accountantExpenses,
  accountantFlags,
  accountantInvoice,
  accountantInvoices,
  accountantPayments,
  accountantReceiptPath,
} from '@/lib/data/accountant';

type Row = Record<string, unknown>;
type Call = { table: string; select: string; eq: Array<[string, unknown]> };

/**
 * An in-memory database that really applies the filters it is given, and
 * records every query. Tenant filtering is therefore tested by outcome: rows of
 * another business never come back.
 */
function fakeDb(tables: Record<string, Row[]> = {}, fail?: string) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, select: '', eq: [] };
      calls.push(call);
      const preds: Array<(r: Row) => boolean> = [];
      let head = false;
      let range: [number, number] | null = null;
      const b: Record<string, unknown> = {};
      const get = (r: Row, k: string) => r[k];
      b.select = (cols: string, o?: { head?: boolean }) => {
        call.select = cols;
        head = !!o?.head;
        return b;
      };
      b.eq = (k: string, v: unknown) => { call.eq.push([k, v]); preds.push((r) => get(r, k) === v); return b; };
      b.is = (k: string, v: unknown) => { preds.push((r) => (get(r, k) ?? null) === v); return b; };
      b.in = (k: string, vs: unknown[]) => { preds.push((r) => vs.includes(get(r, k))); return b; };
      b.gt = (k: string, v: number | string) => { preds.push((r) => (get(r, k) as number | string) > v); return b; };
      b.gte = (k: string, v: number | string) => { preds.push((r) => (get(r, k) as number | string) >= v); return b; };
      b.lt = (k: string, v: number | string) => { preds.push((r) => (get(r, k) as number | string) < v); return b; };
      b.lte = (k: string, v: number | string) => { preds.push((r) => (get(r, k) as number | string) <= v); return b; };
      b.order = () => b;
      b.range = (a: number, z: number) => { range = [a, z]; return b; };
      const run = () => {
        if (fail === table) return { data: null, count: null, error: { message: 'boom' } };
        let rows = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
        if (head) return { data: null, count: rows.length, error: null };
        if (range) rows = rows.slice(range[0], range[1] + 1);
        return { data: rows, count: null, error: null };
      };
      b.maybeSingle = async () => {
        const r = run();
        return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error };
      };
      b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject);
      return b;
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

const RANGE = { from: '2026-04-06', to: '2027-04-05' };
const CONTACT = /phone|e164|email|address|postcode|notes?\b|lat|lng|lon/i;

describe('every loader stays inside the business', () => {
  it('filters each query by the business, and customer and expense reads carry no contact columns', async () => {
    const { db, calls } = fakeDb();
    await accountantExpenses(db, 'tenant-1', RANGE);
    await accountantInvoices(db, 'tenant-1', RANGE);
    await accountantPayments(db, 'tenant-1', RANGE);
    await accountantEarliestTaxYear(db, 'tenant-1');
    await accountantReceiptPath(db, 'tenant-1', 'e1');
    await accountantFlags(db, 'tenant-1', RANGE);

    for (const call of calls) {
      const key = call.table === 'tenants' ? 'id' : 'tenant_id';
      expect(call.eq, `${call.table} is filtered by the business`).toContainEqual([key, 'tenant-1']);
      // Invoices are the business's own paperwork and are shown as issued, so their record is read whole.
      if (call.table !== 'invoices') {
        expect(call.select, `${call.table} selects no contact column`).not.toMatch(CONTACT);
      }
    }
  });

  it('never returns another business\'s rows', async () => {
    const { db } = fakeDb({
      expenses: [
        { id: 'a', tenant_id: 't1', status: 'confirmed', spent_on: '2026-10-01', category: 'vehicle', amount: 5, receipt_path: null },
        { id: 'b', tenant_id: 't2', status: 'confirmed', spent_on: '2026-10-01', category: 'vehicle', amount: 9, receipt_path: null },
      ],
      payments: [
        { id: 'p1', tenant_id: 't1', status: 'active', amount: 10, refunded_amount: 0, received_at: '2026-10-01T10:00:00Z', method: 'cash', customers: { name: 'A' } },
        { id: 'p2', tenant_id: 't2', status: 'active', amount: 99, refunded_amount: 0, received_at: '2026-10-01T10:00:00Z', method: 'cash', customers: { name: 'B' } },
      ],
    });
    expect((await accountantExpenses(db, 't1', RANGE)).map((e) => e.id)).toEqual(['a']);
    expect((await accountantPayments(db, 't1', RANGE)).map((p) => p.id)).toEqual(['p1']);
    expect(await accountantReceiptPath(db, 't1', 'b')).toBeNull();
  });

  it('throws on a read error instead of showing partial numbers', async () => {
    for (const [table, fn] of [
      ['expenses', () => accountantExpenses(fakeDb({}, 'expenses').db, 't', RANGE)],
      ['invoices', () => accountantInvoices(fakeDb({}, 'invoices').db, 't', RANGE)],
      ['payments', () => accountantPayments(fakeDb({}, 'payments').db, 't', RANGE)],
    ] as const) {
      await expect(fn(), table).rejects.toThrow(/Could not load/);
    }
  });
});

describe('expenses and payments', () => {
  it('shows only saved expenses and active payments, mapped', async () => {
    const { db } = fakeDb({
      expenses: [
        { id: 'a', tenant_id: 't', status: 'confirmed', spent_on: '2026-10-01', merchant: 'Shell', category: 'vehicle', amount: '60.00', vat_amount: '10', receipt_path: 'x' },
        { id: 'd', tenant_id: 't', status: 'draft', spent_on: '2026-10-01', merchant: 'Draft', category: 'vehicle', amount: 5, receipt_path: 'y' },
        { id: 'u', tenant_id: 't', status: 'confirmed', spent_on: '2026-10-01', merchant: null, category: 'fuel', amount: 5, receipt_path: null },
      ],
      payments: [
        { id: 'p', tenant_id: 't', status: 'active', amount: 40, refunded_amount: 0, received_at: '2027-03-31T23:30:00Z', method: 'cash', customers: [{ name: 'Bob' }] },
        { id: 'v', tenant_id: 't', status: 'void', amount: 40, refunded_amount: 0, received_at: '2026-10-01T10:00:00Z', method: 'cash', customers: { name: 'X' } },
      ],
    });
    expect(await accountantExpenses(db, 't', RANGE)).toEqual([
      { id: 'a', spentOn: '2026-10-01', merchant: 'Shell', category: 'vehicle', amount: 60, vatAmount: 10, hasReceipt: true },
    ]);
    expect(await accountantPayments(db, 't', RANGE)).toEqual([
      { id: 'p', receivedOn: '2027-04-01', customerName: 'Bob', amount: 40, refunded: 0, method: 'cash' },
    ]);
  });

  it('reads the customer for a payment as name only', async () => {
    const { db, calls } = fakeDb();
    await accountantPayments(db, 't', RANGE);
    expect(calls[0].select).toContain('customers(name)');
    expect(calls[0].select).not.toMatch(/customers\([^)]*,/);
  });

  it('only gives the receipt of a saved expense, and null when there is none', async () => {
    const { db } = fakeDb({
      expenses: [
        { id: 'ok', tenant_id: 't', status: 'confirmed', receipt_path: 't/a.jpg' },
        { id: 'draft', tenant_id: 't', status: 'draft', receipt_path: 't/b.jpg' },
        { id: 'none', tenant_id: 't', status: 'confirmed', receipt_path: null },
      ],
    });
    expect(await accountantReceiptPath(db, 't', 'ok')).toBe('t/a.jpg');
    expect(await accountantReceiptPath(db, 't', 'draft')).toBeNull();
    expect(await accountantReceiptPath(db, 't', 'none')).toBeNull();
  });
});

function invoiceRow(over: Row = {}): Row {
  return {
    id: 'i1', tenant_id: 't', customer_id: 'c1', number: 'INV-0001', kind: 'visit', status: 'issued',
    issue_date: '2026-09-01', due_date: '2026-09-15', seller_name: 'Bright', bill_to_name: 'Mrs Patel',
    bill_to_address: '22 Rose Lane', bill_to_email: 'p@example.com', total: 20, vat_amount: 0,
    subtotal_net: 20, public_token: 'tok', ...over,
  };
}
const line = (invoice_id: string, job_id: string, amount = 20): Row => ({ invoice_id, job_id, description: 'Clean', amount, sort_order: 0 });

describe('accountantInvoices', () => {
  it('gives each invoice its real status, paid and balance', async () => {
    const { db } = fakeDb({
      invoices: [
        invoiceRow({ id: 'paid', number: 'INV-1' }),
        invoiceRow({ id: 'part', number: 'INV-2' }),
        invoiceRow({ id: 'late', number: 'INV-3' }),
        invoiceRow({ id: 'void', number: 'INV-4', status: 'void' }),
      ],
      invoice_lines: [line('paid', 'j1'), line('part', 'j2'), line('late', 'j3'), line('void', 'j4')],
      payment_allocations: [
        { job_id: 'j1', amount: 20 },
        { job_id: 'j2', amount: 5 },
        { job_id: 'j4', amount: 20 },
      ],
    });
    const rows = await accountantInvoices(db, 't', RANGE);
    const by = Object.fromEntries(rows.map((r) => [r.number, r]));
    expect(by['INV-1']).toMatchObject({ status: 'Paid', paid: 20, balance: 0, customerName: 'Mrs Patel' });
    expect(by['INV-2']).toMatchObject({ status: 'Overdue', paid: 5, balance: 15 }); // due 15 Sep 2026, long past
    expect(by['INV-3']).toMatchObject({ status: 'Overdue', paid: 0, balance: 20 });
    expect(by['INV-4']).toMatchObject({ status: 'Cancelled', paid: 0, balance: 0 });
  });

  it("does not hand the customer's address or email to the list", async () => {
    const { db } = fakeDb({ invoices: [invoiceRow()], invoice_lines: [line('i1', 'j1')] });
    const rows = await accountantInvoices(db, 't', RANGE);
    expect(JSON.stringify(rows)).not.toMatch(/Rose Lane|example\.com/);
  });

  it('keeps to this business and to the period', async () => {
    const { db } = fakeDb({
      invoices: [
        invoiceRow({ id: 'mine' }),
        invoiceRow({ id: 'theirs', tenant_id: 'other' }),
        invoiceRow({ id: 'old', issue_date: '2025-01-01' }),
      ],
    });
    expect((await accountantInvoices(db, 't', RANGE)).map((r) => r.id)).toEqual(['mine']);
  });
});

describe('accountantInvoice', () => {
  it('gives the invoice as issued, with the payments received against it, grouped by payment', async () => {
    const { db } = fakeDb({
      invoices: [invoiceRow()],
      invoice_lines: [line('i1', 'j1', 10), line('i1', 'j2', 10)],
      payment_allocations: [
        { tenant_id: 't', payment_id: 'pay1', job_id: 'j1', amount: 10, payments: { received_at: '2026-09-03T09:00:00Z', method: 'cash', status: 'active' } },
        { tenant_id: 't', payment_id: 'pay1', job_id: 'j2', amount: 4, payments: { received_at: '2026-09-03T09:00:00Z', method: 'cash', status: 'active' } },
        { tenant_id: 't', payment_id: 'pay2', job_id: 'j2', amount: 6, payments: [{ received_at: '2026-09-10T09:00:00Z', method: 'card', status: 'active' }] },
        { tenant_id: 't', payment_id: 'pay3', job_id: 'j2', amount: 99, payments: { received_at: '2026-09-11T09:00:00Z', method: 'cash', status: 'void' } },
        { tenant_id: 'other', payment_id: 'pay4', job_id: 'j1', amount: 77, payments: { received_at: '2026-09-12T09:00:00Z', method: 'cash', status: 'active' } },
      ],
    });
    const found = await accountantInvoice(db, 't', 'i1');
    expect(found?.invoice.billTo.address).toBe('22 Rose Lane'); // as issued
    expect(found?.payments).toEqual([
      { receivedOn: '2026-09-03', method: 'cash', amount: 14 },
      { receivedOn: '2026-09-10', method: 'card', amount: 6 },
    ]);
  });

  it('is null for an invoice of another business', async () => {
    const { db } = fakeDb({ invoices: [invoiceRow({ tenant_id: 'other' })] });
    expect(await accountantInvoice(db, 't', 'i1')).toBeNull();
  });
});

describe('accountantFlags', () => {
  const tables = () => ({
    expenses: [
      { id: 'e1', tenant_id: 't', status: 'confirmed', spent_on: '2026-10-01', amount: 10, receipt_path: null },
      { id: 'e2', tenant_id: 't', status: 'confirmed', spent_on: '2026-10-02', amount: 15.5, receipt_path: null },
      { id: 'e3', tenant_id: 't', status: 'confirmed', spent_on: '2026-10-03', amount: 99, receipt_path: 'x' },
      { id: 'e4', tenant_id: 't', status: 'confirmed', spent_on: '2020-01-01', amount: 99, receipt_path: null },
      { id: 'e5', tenant_id: 'other', status: 'confirmed', spent_on: '2026-10-01', amount: 99, receipt_path: null },
      { id: 'd1', tenant_id: 't', status: 'draft', spent_on: null, amount: null, receipt_path: 'y' },
      { id: 'd2', tenant_id: 't', status: 'draft', spent_on: null, amount: null, receipt_path: 'z' },
    ],
    payments: [
      { id: 'p1', tenant_id: 't', status: 'active', amount: 12, refunded_amount: 12, received_at: '2026-10-01T10:00:00Z' },
      { id: 'p2', tenant_id: 't', status: 'active', amount: 24, refunded_amount: 24, received_at: '2026-10-01T10:00:00Z' },
      { id: 'p3', tenant_id: 't', status: 'active', amount: 30, refunded_amount: 5, received_at: '2026-10-01T10:00:00Z' },
      { id: 'p4', tenant_id: 't', status: 'active', amount: 30, refunded_amount: 0, received_at: '2026-10-01T10:00:00Z' },
      { id: 'p5', tenant_id: 't', status: 'void', amount: 30, refunded_amount: 30, received_at: '2026-10-01T10:00:00Z' },
      { id: 'p6', tenant_id: 'other', status: 'active', amount: 30, refunded_amount: 30, received_at: '2026-10-01T10:00:00Z' },
    ],
    customer_balances: [
      { customer_id: 'c1', tenant_id: 't', owed_amount: 30.5 },
      { customer_id: 'c2', tenant_id: 't', owed_amount: 19.5 },
      { customer_id: 'c3', tenant_id: 't', owed_amount: 0 },
      { customer_id: 'c4', tenant_id: 'other', owed_amount: 500 },
    ],
  });

  it('counts what is worth asking about, for this business and period only', async () => {
    const flags = await accountantFlags(fakeDb(tables()).db, 't', RANGE);
    expect(flags).toEqual({
      noReceipt: { count: 2, amount: 25.5 },
      unchecked: 2,
      refundedInFull: { count: 2, amount: 36 },
      refundedInPart: { count: 1, amount: 5 },
      owed: { amount: 50, customers: 2 },
    });
  });

  it('is all zeros when there is nothing to flag', async () => {
    expect(await accountantFlags(fakeDb({}).db, 't', RANGE)).toEqual({
      noReceipt: { count: 0, amount: 0 },
      unchecked: 0,
      refundedInFull: { count: 0, amount: 0 },
      refundedInPart: { count: 0, amount: 0 },
      owed: { amount: 0, customers: 0 },
    });
  });

  it('throws on any read error, so a wrong "all clear" is never shown', async () => {
    for (const table of ['expenses', 'payments', 'customer_balances']) {
      await expect(accountantFlags(fakeDb(tables(), table).db, 't', RANGE), table).rejects.toThrow();
    }
  });
});
