import { describe, expect, it, vi } from 'vitest';
import { strFromU8 } from 'fflate';
import { periodRange } from '@/lib/books/periods';
import {
  buildAllDataCsvs,
  buildTaxYearFiles,
  MAX_INVOICES_PER_ZIP,
  taxYearRange,
  type DownloadDeps,
} from '@/lib/downloads/builders';
import { fakeDb, type Row } from '@/lib/downloads/__tests__/fake-db';

const RANGE = periodRange({ kind: 'tax_year', startYear: 2026 });
const CONTACT = /phone|e164|email|address|postcode|notes?\b|lat\b|lng\b/i;

const headerOf = (csv: string) => csv.replace(/^﻿/, '').split('\r\n')[0];
const linesOf = (csv: string) => csv.replace(/^﻿/, '').split('\r\n').filter(Boolean);

function invoiceRow(over: Row = {}): Row {
  return {
    id: 'i1', tenant_id: 't1', customer_id: 'c1', number: 'INV-0001', kind: 'visit', status: 'issued',
    issue_date: '2026-09-01', due_date: '2026-09-15', seller_name: 'Bright Windows', bill_to_name: 'Mrs Patel',
    bill_to_address: '22 Rose Lane', bill_to_email: 'p@example.com', total: 20, subtotal_net: 20, vat_amount: 0,
    public_token: 'tok', ...over,
  };
}

function data(): Record<string, Row[]> {
  return {
    tenants: [{ id: 't1', name: 'Bright Windows' }, { id: 't2', name: 'Other' }],
    tenant_payment_settings: [{ tenant_id: 't1', vat_registered: false, vat_rate_percent: 20 }],
    customers: [
      { id: 'c1', tenant_id: 't1', name: 'Mrs Patel', company_name: null, phone: '07700900001', email: 'p@example.com', billing_address: '22 Rose Lane', payment_terms: 'on_receipt', access_notes: 'Side gate', notes: 'Dog', is_active: true },
      { id: 'c9', tenant_id: 't2', name: 'Their Customer', phone: '999', email: 'x@y.com', is_active: true },
    ],
    service_agreements: [
      { id: 's1', tenant_id: 't1', title: 'Windows', price: 15, frequency_days: 28, next_due_date: '2026-10-10', status: 'active', preferred_weekday: 2, address: '22 Rose Lane', postcode: 'WN1 1AA', customers: { name: 'Mrs Patel' } },
    ],
    jobs: [
      { id: 'j1', tenant_id: 't1', scheduled_date: '2026-09-02', job_description: 'Windows', status: 'completed', quoted_amount: 15, final_amount: null, payment_status: 'paid', skip_reason: null, customers: { name: 'Mrs Patel' } },
    ],
    payments: [
      { id: 'p1', tenant_id: 't1', status: 'active', amount: 20, refunded_amount: 5, received_at: '2026-09-03T09:00:00Z', method: 'cash', source: 'manual', note: 'Paid at door', customers: { name: 'Mrs Patel' } },
      { id: 'p2', tenant_id: 't1', status: 'active', amount: 30, refunded_amount: 0, received_at: '2027-03-31T23:30:00Z', method: 'card', source: 'stripe', note: null, customers: { name: 'Mrs Patel' } },
      { id: 'p3', tenant_id: 't1', status: 'void', amount: 99, refunded_amount: 0, received_at: '2026-09-03T09:00:00Z', method: 'cash', source: 'manual', customers: { name: 'Void' } },
      { id: 'p4', tenant_id: 't2', status: 'active', amount: 77, refunded_amount: 0, received_at: '2026-09-03T09:00:00Z', method: 'cash', source: 'manual', customers: { name: 'Other' } },
      { id: 'p5', tenant_id: 't1', status: 'active', amount: 11, refunded_amount: 0, received_at: '2025-01-01T09:00:00Z', method: 'cash', source: 'manual', customers: { name: 'Last year' } },
    ],
    expenses: [
      { id: 'abcdef1234', tenant_id: 't1', status: 'confirmed', spent_on: '2026-09-28', merchant: 'Screwfix', category: 'supplies', amount: 24.99, vat_amount: 4.17, note: 'Rubbers', receipt_path: 't1/abcdef1234.jpg' },
      { id: 'b2', tenant_id: 't1', status: 'confirmed', spent_on: '2026-09-20', merchant: '=HYPERLINK("x")', category: 'vehicle', amount: 60, vat_amount: null, note: null, receipt_path: null },
      { id: 'd1', tenant_id: 't1', status: 'draft', spent_on: '2026-09-21', merchant: 'Draft', category: 'vehicle', amount: 5, receipt_path: 't1/d1.jpg' },
      { id: 'o1', tenant_id: 't1', status: 'confirmed', spent_on: '2025-02-01', merchant: 'Old', category: 'vehicle', amount: 5, receipt_path: null },
      { id: 'x1', tenant_id: 't2', status: 'confirmed', spent_on: '2026-09-21', merchant: 'Theirs', category: 'vehicle', amount: 500, receipt_path: null },
    ],
    invoices: [invoiceRow(), invoiceRow({ id: 'i2', number: 'INV-0002', total: 12, subtotal_net: 12, issue_date: '2026-10-01', bill_to_name: 'Mr Jones' }), invoiceRow({ id: 'ix', tenant_id: 't2', number: 'INV-9' })],
    invoice_lines: [
      { invoice_id: 'i1', job_id: 'j1', description: 'Windows', amount: 20, sort_order: 0 },
      { invoice_id: 'i2', job_id: 'j2', description: 'Windows', amount: 12, sort_order: 0 },
    ],
    payment_allocations: [{ job_id: 'j1', amount: 20 }],
    customer_charges: [
      { id: 'ch1', tenant_id: 't1', charge_date: '2026-04-06', description: 'Owed from before', amount: 40, status: 'active', customers: { name: 'Mrs Patel' } },
      { id: 'ch2', tenant_id: 't2', charge_date: '2026-04-06', description: 'Theirs', amount: 1, status: 'active', customers: { name: 'X' } },
    ],
  };
}

const deps = (over: Partial<DownloadDeps> = {}): DownloadDeps => ({
  downloadReceipt: async () => new Uint8Array([1, 2, 3]),
  renderPdf: async () => new Uint8Array([37, 80, 68, 70]),
  ...over,
});

describe('taxYearRange', () => {
  it('gives the whole year and the four quarters', () => {
    expect(taxYearRange(2026)).toMatchObject({ from: '2026-04-06', to: '2027-04-05', quarter: null });
    expect(taxYearRange(2026, 1)).toMatchObject({ from: '2026-04-06', to: '2026-07-05' });
    expect(taxYearRange(2026, 2)).toMatchObject({ from: '2026-07-06', to: '2026-10-05' });
    expect(taxYearRange(2026, 3)).toMatchObject({ from: '2026-10-06', to: '2027-01-05' });
    expect(taxYearRange(2026, 4)).toMatchObject({ from: '2027-01-06', to: '2027-04-05' });
    expect(taxYearRange(2026, 3).label).toContain('quarter 3');
  });
});

describe('the accountant\'s spreadsheets', () => {
  it('has the money files only: no customer list, schedules or visits', async () => {
    const { db } = fakeDb(data());
    const files = await buildAllDataCsvs(db, { tenantId: 't1', audience: 'accountant', range: RANGE });
    expect(files.map((f) => f.name).sort()).toEqual([
      'README.txt', 'expenses-by-hmrc-heading.csv', 'expenses.csv', 'in-and-out.csv', 'invoices.csv',
      'other-amounts-owed.csv', 'payments.csv', 'summary.csv',
    ]);
  });

  it('has no phone, email, address, postcode or notes column in any file', async () => {
    const { db } = fakeDb(data());
    const files = await buildAllDataCsvs(db, { tenantId: 't1', audience: 'accountant', range: RANGE });
    for (const f of files.filter((x) => x.name.endsWith('.csv'))) {
      expect(headerOf(f.content), f.name).not.toMatch(CONTACT);
    }
    const all = files.map((f) => f.content).join('\n');
    for (const secret of ['07700900001', 'p@example.com', '22 Rose Lane', 'WN1 1AA', 'Side gate', 'Paid at door', 'Rubbers']) {
      expect(all, secret).not.toContain(secret);
    }
  });

  it('never even reads the payment or expense notes', async () => {
    const { db, queries } = fakeDb(data());
    await buildAllDataCsvs(db, { tenantId: 't1', audience: 'accountant', range: RANGE });
    for (const q of queries.filter((x) => x.table === 'payments' || x.table === 'expenses')) {
      expect(q.select).not.toMatch(/\bnote\b/);
    }
    expect(queries.map((q) => q.table)).not.toContain('customers');
    expect(queries.map((q) => q.table)).not.toContain('service_agreements');
    expect(queries.map((q) => q.table)).not.toContain('jobs');
  });
});

describe('the business\'s own spreadsheets', () => {
  it('adds the customer list, schedules and visits, with contact details, and everything ever', async () => {
    const { db } = fakeDb(data());
    const files = await buildAllDataCsvs(db, { tenantId: 't1', audience: 'trader' });
    const names = files.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(['customers.csv', 'schedules.csv', 'visits.csv', 'payments.csv', 'expenses.csv']));
    const customers = files.find((f) => f.name === 'customers.csv')!.content;
    expect(customers).toContain('07700900001');
    expect(customers).toContain('Side gate');
    // No range: last year's payment and expense are in too.
    expect(files.find((f) => f.name === 'payments.csv')!.content).toContain('Last year');
    expect(files.find((f) => f.name === 'expenses.csv')!.content).toContain('Old');
    expect(names).not.toContain('summary.csv'); // no period, so no period summary
  });

  it('keeps the payment and expense notes', async () => {
    const { db } = fakeDb(data());
    const files = await buildAllDataCsvs(db, { tenantId: 't1', audience: 'trader', range: RANGE });
    expect(files.find((f) => f.name === 'payments.csv')!.content).toContain('Paid at door');
    expect(files.find((f) => f.name === 'expenses.csv')!.content).toContain('Rubbers');
  });
});

describe('what is counted', () => {
  it('stays inside the business, the period, and active payments / saved expenses', async () => {
    const { db } = fakeDb(data());
    const files = await buildAllDataCsvs(db, { tenantId: 't1', audience: 'accountant', range: RANGE });
    const by = (n: string) => files.find((f) => f.name === n)!.content;
    expect(linesOf(by('payments.csv'))).toHaveLength(3); // header + p1 + p2
    expect(by('payments.csv')).not.toMatch(/Void|Other|Last year/);
    expect(linesOf(by('expenses.csv'))).toHaveLength(3); // header + two saved expenses in range
    expect(by('expenses.csv')).not.toMatch(/Draft|Theirs|Old/);
    expect(by('invoices.csv')).not.toContain('INV-9');
    expect(by('other-amounts-owed.csv')).not.toContain('Theirs');
  });

  it('puts a late-evening UTC payment in the right London day and nets off refunds', async () => {
    const { db } = fakeDb(data());
    const files = await buildAllDataCsvs(db, { tenantId: 't1', audience: 'accountant', range: RANGE });
    const payments = files.find((f) => f.name === 'payments.csv')!.content;
    expect(payments).toContain('2027-04-01,Mrs Patel,30.00,0.00,30.00,Card,stripe'); // 23:30 UTC 31 Mar = 1 Apr in London
    expect(payments).toContain('2026-09-03,Mrs Patel,20.00,5.00,15.00,Cash,manual');
    const summary = files.find((f) => f.name === 'summary.csv')!.content;
    expect(summary).toContain('Money in,45.00');
    expect(summary).toContain('Money out,84.99');
    expect(summary).toContain('Left (money in less money out),-39.99');
  });

  it('shows the HMRC heading, net amounts, and guards a formula in a supplier name', async () => {
    const { db } = fakeDb(data());
    const files = await buildAllDataCsvs(db, { tenantId: 't1', audience: 'accountant', range: RANGE });
    const expenses = files.find((f) => f.name === 'expenses.csv')!.content;
    expect(expenses).toContain('Cost of goods bought for resale or goods used,24.99,4.17,20.82');
    expect(expenses).toContain(`"'=HYPERLINK(""x"")"`);
    expect(files.find((f) => f.name === 'expenses-by-hmrc-heading.csv')!.content).toContain('Car, van and travel expenses');
  });

  it('gives invoices their status, paid and balance', async () => {
    const { db } = fakeDb(data());
    const files = await buildAllDataCsvs(db, { tenantId: 't1', audience: 'accountant', range: RANGE });
    const invoices = files.find((f) => f.name === 'invoices.csv')!.content;
    expect(invoices).toContain('INV-0001,2026-09-01,2026-09-15,Mrs Patel,20.00,0.00,20.00,20.00,0.00,Paid');
    expect(invoices).toContain('INV-0002,2026-10-01,2026-09-15,Mr Jones,12.00,0.00,12.00,0.00,12.00,Overdue');
  });

  it('gives 12 months for a whole tax year, and none for a quarter', async () => {
    const { db } = fakeDb(data());
    const year = await buildAllDataCsvs(db, { tenantId: 't1', audience: 'accountant', range: RANGE });
    expect(linesOf(year.find((f) => f.name === 'in-and-out.csv')!.content)).toHaveLength(13);
    const q = await buildAllDataCsvs(db, { tenantId: 't1', audience: 'accountant', range: taxYearRange(2026, 2) });
    expect(q.find((f) => f.name === 'in-and-out.csv')).toBeUndefined();
  });

  it('has a README that says how the numbers are counted', async () => {
    const { db } = fakeDb(data());
    const readme = (await buildAllDataCsvs(db, { tenantId: 't1', audience: 'accountant', range: RANGE })).find((f) => f.name === 'README.txt')!.content;
    expect(readme).toContain('Bright Windows');
    expect(readme).toContain('2026/27 tax year');
    expect(readme).toContain('Money in is counted on the day it arrived');
    expect(readme).toContain('read-only copy for the accountant');
  });

  it('pages through more than 1,000 payments', async () => {
    const many = Array.from({ length: 2300 }, (_, i) => ({
      id: `p${i}`, tenant_id: 't1', status: 'active', amount: 1, refunded_amount: 0, received_at: '2026-09-03T09:00:00Z', method: 'cash', source: 'manual', customers: { name: 'A' },
    }));
    const { db } = fakeDb({ ...data(), payments: many });
    const files = await buildAllDataCsvs(db, { tenantId: 't1', audience: 'accountant', range: RANGE });
    expect(linesOf(files.find((f) => f.name === 'payments.csv')!.content)).toHaveLength(2301);
  });

  it('throws on a read error instead of making a short download', async () => {
    const { db } = fakeDb(data(), { failTable: 'payments' });
    await expect(buildAllDataCsvs(db, { tenantId: 't1', audience: 'accountant', range: RANGE })).rejects.toThrow('Could not load payments');
  });
});

describe('the tax-year pack', () => {
  it('adds the receipt photos and invoice PDFs, named so a person can find them', async () => {
    const { db } = fakeDb(data());
    const result = await buildTaxYearFiles(db, { tenantId: 't1', startYear: 2026, audience: 'accountant' }, deps());
    if (!result.ok) throw new Error('too many');
    const names = result.files.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(['README.txt', 'payments.csv', 'expenses.csv', 'invoices/INV-0001.pdf', 'invoices/INV-0002.pdf', 'receipts/2026-09-28-screwfix-abcdef.jpg']));
    expect(names.filter((n) => n.startsWith('receipts/'))).toHaveLength(1); // the draft's photo is not included
    const expenses = strFromU8(result.files.find((f) => f.name === 'expenses.csv')!.bytes);
    expect(expenses).toContain('receipts/2026-09-28-screwfix-abcdef.jpg');
    expect(result.periodLabel).toBe('2026/27 tax year');
  });

  it('marks a receipt that cannot be fetched, and carries on', async () => {
    const { db } = fakeDb(data());
    const result = await buildTaxYearFiles(db, { tenantId: 't1', startYear: 2026, audience: 'accountant' }, deps({ downloadReceipt: async () => null }));
    if (!result.ok) throw new Error('too many');
    expect(result.files.some((f) => f.name.startsWith('receipts/'))).toBe(false);
    expect(strFromU8(result.files.find((f) => f.name === 'expenses.csv')!.bytes)).toContain('missing');
    expect(strFromU8(result.files.find((f) => f.name === 'README.txt')!.bytes)).toContain('1 receipt photo couldn’t be fetched');
  });

  it('skips an invoice that will not draw, notes it in the README, and still makes the ZIP', async () => {
    const { db } = fakeDb(data());
    const renderPdf = vi.fn(async (inv: { number: string }) => {
      if (inv.number === 'INV-0002') throw new Error('boom');
      return new Uint8Array([1]);
    });
    const result = await buildTaxYearFiles(db, { tenantId: 't1', startYear: 2026, audience: 'accountant' }, deps({ renderPdf: renderPdf as DownloadDeps['renderPdf'] }));
    if (!result.ok) throw new Error('too many');
    const names = result.files.map((f) => f.name);
    expect(names).toContain('invoices/INV-0001.pdf');
    expect(names).not.toContain('invoices/INV-0002.pdf');
    expect(strFromU8(result.files.find((f) => f.name === 'README.txt')!.bytes)).toContain('Couldn’t make INV-0002.pdf');
  });

  it('refuses above 400 invoices and offers a quarter instead', async () => {
    const lots = Array.from({ length: MAX_INVOICES_PER_ZIP + 1 }, (_, i) => invoiceRow({ id: `i${i}`, number: `INV-${i}` }));
    const { db } = fakeDb({ ...data(), invoices: lots });
    expect(await buildTaxYearFiles(db, { tenantId: 't1', startYear: 2026, audience: 'accountant' }, deps())).toEqual({
      ok: false, error: 'too_many', invoiceCount: 401,
    });
    // Exactly 400 is fine.
    const { db: ok } = fakeDb({ ...data(), invoices: lots.slice(0, 400), invoice_lines: [] });
    expect((await buildTaxYearFiles(ok, { tenantId: 't1', startYear: 2026, audience: 'accountant' }, deps())).ok).toBe(true);
  });

  it('keeps the accountant\'s pack free of customer contact columns too', async () => {
    const { db } = fakeDb(data());
    const result = await buildTaxYearFiles(db, { tenantId: 't1', startYear: 2026, audience: 'accountant' }, deps());
    if (!result.ok) throw new Error('too many');
    for (const f of result.files.filter((x) => x.name.endsWith('.csv'))) {
      expect(headerOf(strFromU8(f.bytes)), f.name).not.toMatch(CONTACT);
    }
  });

  it('a quarter only holds that quarter\'s money', async () => {
    const { db } = fakeDb(data());
    const result = await buildTaxYearFiles(db, { tenantId: 't1', startYear: 2026, quarter: 2, audience: 'trader' }, deps());
    if (!result.ok) throw new Error('too many');
    const payments = strFromU8(result.files.find((f) => f.name === 'payments.csv')!.bytes);
    expect(payments).toContain('2026-09-03'); // 6 Jul – 5 Oct
    expect(payments).not.toContain('2027-04-01');
  });
});
