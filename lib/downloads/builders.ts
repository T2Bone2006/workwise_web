import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { isExpenseCategory } from '@/lib/books/categories';
import { londonDateOf, periodRange, type PeriodRange } from '@/lib/books/periods';
import { summarise, type BooksSummary } from '@/lib/books/summary-pure';
import {
  chargesCsv,
  customersCsv,
  expensesByHmrcCsv,
  expensesCsv,
  inAndOutCsv,
  invoicesCsv,
  paymentsCsv,
  readmeText,
  schedulesCsv,
  summaryCsv,
  visitsCsv,
  type Audience,
  type ChargeCsvRow,
  type CsvFile,
  type CustomerCsvRow,
  type ExpenseCsvRow,
  type InvoiceCsvRow,
  type PaymentCsvRow,
  type ScheduleCsvRow,
  type VisitCsvRow,
} from '@/lib/downloads/csv-files';
import { strToU8 } from 'fflate';
import { assembleInvoices, INVOICE_COLUMNS, type InvoiceRecord } from '@/lib/data/payments/invoices';
import { readAllPages } from '@/lib/data/read-all-pages';
import { RECEIPT_BUCKET } from '@/lib/expenses/read-receipt';
import { renderInvoicePdf } from '@/lib/invoices/render';
import { invoiceStatus } from '@/lib/invoices/status';
import { toInvoiceViewModel } from '@/lib/invoices/view-model';
import { londonDayBoundsUtc, todayInLondon } from '@/lib/rounds/dates';

export type { Audience, CsvFile };

/** More invoices than this and a tax-year ZIP is too big for one go: the person picks a quarter. */
export const MAX_INVOICES_PER_ZIP = 400;
const CONCURRENCY = 4;

/** Who reads the files and what a download is of. Tests swap these for fakes. */
export type DownloadDeps = {
  downloadReceipt: (path: string) => Promise<Uint8Array | null>;
  renderPdf: (invoice: InvoiceRecord) => Promise<Uint8Array>;
};

export function defaultDeps(admin: SupabaseClient): DownloadDeps {
  return {
    async downloadReceipt(path) {
      const { data, error } = await admin.storage.from(RECEIPT_BUCKET).download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async renderPdf(invoice) {
      // No pay-by-card link: whoever downloads this has nothing to pay.
      return new Uint8Array(await renderInvoicePdf(toInvoiceViewModel(invoice, { cardUrl: null })));
    },
  };
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

// --- ranges ---

export type TaxYearRange = PeriodRange & { startYear: number; quarter: 1 | 2 | 3 | 4 | null };

/** A tax year, or one quarter of it: Q1 6 Apr–5 Jul, Q2 6 Jul–5 Oct, Q3 6 Oct–5 Jan, Q4 6 Jan–5 Apr. */
export function taxYearRange(startYear: number, quarter?: 1 | 2 | 3 | 4 | null): TaxYearRange {
  const whole = periodRange({ kind: 'tax_year', startYear });
  if (!quarter) return { ...whole, startYear, quarter: null };
  const next = startYear + 1;
  const bounds = {
    1: [`${startYear}-04-06`, `${startYear}-07-05`],
    2: [`${startYear}-07-06`, `${startYear}-10-05`],
    3: [`${startYear}-10-06`, `${next}-01-05`],
    4: [`${next}-01-06`, `${next}-04-05`],
  } as const;
  const [from, to] = bounds[quarter];
  return { from, to, label: `${whole.label.replace(' tax year', '')} tax year, quarter ${quarter}`, startYear, quarter };
}

// --- reading the business's money ---

type Range = Pick<PeriodRange, 'from' | 'to'> | undefined;

export async function businessName(admin: SupabaseClient, tenantId: string): Promise<string> {
  const { data } = await admin.from('tenants').select('name').eq('id', tenantId).maybeSingle();
  return (data as { name?: string } | null)?.name?.trim() || 'your business';
}

async function loadPayments(admin: SupabaseClient, tenantId: string, range: Range, audience: Audience): Promise<PaymentCsvRow[]> {
  // The accountant's copy never even reads the payment note.
  const columns = `id, amount, refunded_amount, received_at, method, source, customers(name)${audience === 'trader' ? ', note' : ''}`;
  const rows = await readAllPages(
    (from, to) => {
      let q = admin.from('payments').select(columns).eq('tenant_id', tenantId).eq('status', 'active');
      if (range) {
        q = q.gte('received_at', londonDayBoundsUtc(range.from).startIso).lt('received_at', londonDayBoundsUtc(range.to).endIso);
      }
      return q.order('received_at', { ascending: true }).order('id', { ascending: true }).range(from, to);
    },
    'Could not load payments',
  );
  return rows.map((r) => {
    const embed = r.customers;
    const customer = (Array.isArray(embed) ? embed[0] : embed) as { name?: unknown } | null | undefined;
    return {
      receivedOn: londonDateOf(String(r.received_at)),
      customerName: str(customer?.name) ?? '',
      amount: num(r.amount),
      refunded: num(r.refunded_amount),
      method: String(r.method ?? 'other'),
      source: String(r.source ?? ''),
      note: audience === 'trader' ? str(r.note) : null,
    };
  });
}

type ExpenseRead = ExpenseCsvRow & { id: string; receiptPath: string | null };

async function loadExpenses(admin: SupabaseClient, tenantId: string, range: Range, audience: Audience): Promise<ExpenseRead[]> {
  const columns = `id, spent_on, merchant, category, amount, vat_amount, receipt_path${audience === 'trader' ? ', note' : ''}`;
  const rows = await readAllPages(
    (from, to) => {
      let q = admin.from('expenses').select(columns).eq('tenant_id', tenantId).eq('status', 'confirmed');
      if (range) q = q.gte('spent_on', range.from).lte('spent_on', range.to);
      return q.order('spent_on', { ascending: true }).order('id', { ascending: true }).range(from, to);
    },
    'Could not load expenses',
  );
  return rows.flatMap((r) =>
    typeof r.spent_on === 'string' && isExpenseCategory(r.category)
      ? [
          {
            id: String(r.id),
            spentOn: r.spent_on,
            merchant: str(r.merchant),
            category: r.category,
            amount: num(r.amount),
            vatAmount: r.vat_amount == null ? null : num(r.vat_amount),
            note: audience === 'trader' ? str(r.note) : null,
            receiptFile: '',
            receiptPath: str(r.receipt_path),
          },
        ]
      : [],
  );
}

async function loadInvoices(admin: SupabaseClient, tenantId: string, range: Range): Promise<InvoiceRecord[]> {
  const rows = await readAllPages(
    (from, to) => {
      let q = admin.from('invoices').select(INVOICE_COLUMNS).eq('tenant_id', tenantId);
      if (range) q = q.gte('issue_date', range.from).lte('issue_date', range.to);
      return q.order('issue_date', { ascending: true }).order('number', { ascending: true }).range(from, to);
    },
    'Could not load invoices',
  );
  return assembleInvoices(admin, rows);
}

function invoiceRows(invoices: InvoiceRecord[]): InvoiceCsvRow[] {
  return invoices.map((inv) => ({
    number: inv.number,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    customerName: inv.billTo.name,
    net: inv.subtotalNet,
    vat: inv.vatAmount,
    total: inv.total,
    paid: inv.status === 'void' ? 0 : inv.paidNow,
    balance: inv.status === 'void' ? 0 : inv.balanceDue,
    status: invoiceStatus(inv),
  }));
}

async function loadCharges(admin: SupabaseClient, tenantId: string, range: Range): Promise<ChargeCsvRow[]> {
  const rows = await readAllPages(
    (from, to) => {
      let q = admin.from('customer_charges').select('id, charge_date, description, amount, status, customers(name)').eq('tenant_id', tenantId);
      if (range) q = q.gte('charge_date', range.from).lte('charge_date', range.to);
      return q.order('charge_date', { ascending: true }).order('id', { ascending: true }).range(from, to);
    },
    'Could not load amounts owed',
  );
  return rows.map((r) => {
    const embed = r.customers;
    const customer = (Array.isArray(embed) ? embed[0] : embed) as { name?: unknown } | null | undefined;
    return {
      date: String(r.charge_date).slice(0, 10),
      customerName: str(customer?.name) ?? '',
      description: String(r.description ?? ''),
      amount: num(r.amount),
      status: r.status === 'void' ? 'Void' : 'Active',
    };
  });
}

async function loadVat(admin: SupabaseClient, tenantId: string): Promise<{ registered: boolean; ratePercent: number }> {
  const { data, error } = await admin
    .from('tenant_payment_settings')
    .select('vat_registered, vat_rate_percent')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw new Error('Could not load settings');
  const row = data as { vat_registered?: boolean; vat_rate_percent?: unknown } | null;
  return { registered: row?.vat_registered === true, ratePercent: row?.vat_rate_percent == null ? 20 : num(row.vat_rate_percent) };
}

// --- the business's own files ---

async function contactCsvs(admin: SupabaseClient, tenantId: string): Promise<CsvFile[]> {
  const [customers, schedules, visits] = await Promise.all([
    readAllPages(
      (from, to) =>
        admin
          .from('customers')
          .select('id, name, company_name, phone, email, billing_address, payment_terms, access_notes, notes, is_active')
          .eq('tenant_id', tenantId)
          .order('name', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      'Could not load customers',
    ),
    readAllPages(
      (from, to) =>
        admin
          .from('service_agreements')
          .select('id, title, price, frequency_days, next_due_date, status, preferred_weekday, address, postcode, customers(name)')
          .eq('tenant_id', tenantId)
          .order('id', { ascending: true })
          .range(from, to),
      'Could not load schedules',
    ),
    readAllPages(
      (from, to) =>
        admin
          .from('jobs')
          .select('id, scheduled_date, job_description, status, quoted_amount, final_amount, payment_status, skip_reason, customers(name)')
          .eq('tenant_id', tenantId)
          .order('scheduled_date', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      'Could not load visits',
    ),
  ]);

  const nameOf = (embed: unknown): string => {
    const c = (Array.isArray(embed) ? embed[0] : embed) as { name?: unknown } | null | undefined;
    return str(c?.name) ?? '';
  };

  const customerRows: CustomerCsvRow[] = customers.map((r) => ({
    name: String(r.name ?? ''),
    company: str(r.company_name),
    phone: str(r.phone),
    email: str(r.email),
    address: str(r.billing_address),
    paymentTerms: str(r.payment_terms),
    accessNotes: str(r.access_notes),
    notes: str(r.notes),
    active: r.is_active !== false,
  }));
  const scheduleRows: ScheduleCsvRow[] = schedules.map((r) => ({
    customerName: nameOf(r.customers),
    service: String(r.title ?? ''),
    price: num(r.price),
    everyDays: num(r.frequency_days),
    nextDue: str(r.next_due_date),
    status: String(r.status ?? ''),
    preferredWeekday: r.preferred_weekday == null ? null : num(r.preferred_weekday),
    address: str(r.address),
    postcode: str(r.postcode),
  }));
  const visitRows: VisitCsvRow[] = visits.map((r) => ({
    date: str(r.scheduled_date),
    customerName: nameOf(r.customers),
    service: String(r.job_description ?? ''),
    status: String(r.status ?? ''),
    price: r.final_amount != null ? num(r.final_amount) : r.quoted_amount != null ? num(r.quoted_amount) : null,
    paidStatus: str(r.payment_status),
    skipReason: str(r.skip_reason),
  }));
  return [customersCsv(customerRows), schedulesCsv(scheduleRows), visitsCsv(visitRows)];
}

// --- assembling ---

type Money = {
  payments: PaymentCsvRow[];
  expenses: ExpenseRead[];
  invoices: InvoiceRecord[];
  charges: ChargeCsvRow[];
  summary: BooksSummary | null;
};

async function loadMoney(admin: SupabaseClient, tenantId: string, range: Range, audience: Audience): Promise<Money> {
  const [payments, expenses, invoices, charges, vat] = await Promise.all([
    loadPayments(admin, tenantId, range, audience),
    loadExpenses(admin, tenantId, range, audience),
    loadInvoices(admin, tenantId, range),
    loadCharges(admin, tenantId, range),
    loadVat(admin, tenantId),
  ]);
  const summary = range
    ? summarise({
        period: { from: range.from, to: range.to, label: (range as PeriodRange).label ?? `${range.from} to ${range.to}` },
        payments: payments.map((p) => ({ receivedAt: `${p.receivedOn}T12:00:00Z`, amount: p.amount, refundedAmount: p.refunded, method: p.method })),
        expenses: expenses.map((e) => ({ spentOn: e.spentOn, amount: e.amount, vatAmount: e.vatAmount, category: e.category })),
        vat,
        withMonths: true,
      })
    : null;
  return { payments, expenses, invoices, charges, summary };
}

function moneyCsvs(m: Money, audience: Audience): CsvFile[] {
  const files: CsvFile[] = [];
  if (m.summary) {
    files.push(summaryCsv(m.summary), expensesByHmrcCsv(m.summary));
    const inOut = inAndOutCsv(m.summary);
    if (inOut) files.push(inOut);
  }
  files.push(
    paymentsCsv(m.payments, audience),
    expensesCsv(m.expenses, audience),
    invoicesCsv(invoiceRows(m.invoices)),
    chargesCsv(m.charges),
  );
  return files;
}

const CONTENTS: Record<string, string> = {
  'summary.csv': 'summary.csv: money in, money out and what is left for the period (with VAT if registered).',
  'expenses-by-hmrc-heading.csv': 'expenses-by-hmrc-heading.csv: expenses grouped under the HMRC self-employment headings.',
  'in-and-out.csv': 'in-and-out.csv: money in, money out and what is left, month by month.',
  'payments.csv': 'payments.csv: every payment received, with refunds and what counted.',
  'expenses.csv': 'expenses.csv: every saved expense, with its HMRC heading, VAT and receipt file.',
  'invoices.csv': 'invoices.csv: every invoice, with VAT, what has been paid and the balance.',
  'other-amounts-owed.csv': 'other-amounts-owed.csv: other amounts owed (such as a balance brought forward).',
  'customers.csv': 'customers.csv: your customer list.',
  'schedules.csv': 'schedules.csv: each customer’s repeat schedule.',
  'visits.csv': 'visits.csv: every visit, with its price and whether it was paid.',
};

/**
 * Every spreadsheet, as text. With no range it is everything, ever (the
 * business's "Download all my data"); with a range it is that period, which is
 * what the accountant gets. The accountant's copy has no customer list,
 * schedules or visits.
 */
export async function buildAllDataCsvs(
  admin: SupabaseClient,
  p: { tenantId: string; audience: Audience; range?: PeriodRange },
): Promise<CsvFile[]> {
  const [business, money] = await Promise.all([
    businessName(admin, p.tenantId),
    loadMoney(admin, p.tenantId, p.range, p.audience),
  ]);
  const files = moneyCsvs(money, p.audience);
  if (p.audience === 'trader') files.push(...(await contactCsvs(admin, p.tenantId)));
  files.push(
    readmeText({
      business,
      downloadedOn: todayInLondon(),
      audience: p.audience,
      periodLabel: p.range?.label ?? null,
      contents: files.map((f) => CONTENTS[f.name]).filter(Boolean),
    }),
  );
  return files;
}

// --- the tax-year pack: spreadsheets + receipt photos + invoice PDFs ---

const slug = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'receipt';

function extensionOf(path: string): string {
  const m = /\.([A-Za-z0-9]{2,5})$/.exec(path);
  return (m?.[1] ?? 'jpg').toLowerCase();
}

/** Run `work` over `items`, a few at a time. Order of results matches the input. */
async function mapLimit<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await work(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export type PackFile = { name: string; bytes: Uint8Array };

export async function buildTaxYearFiles(
  admin: SupabaseClient,
  p: { tenantId: string; startYear: number; quarter?: 1 | 2 | 3 | 4 | null; audience: Audience },
  deps: DownloadDeps = defaultDeps(admin),
): Promise<{ ok: true; files: PackFile[]; periodLabel: string } | { ok: false; error: 'too_many'; invoiceCount: number }> {
  const range = taxYearRange(p.startYear, p.quarter);

  const { count, error: countError } = await admin
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', p.tenantId)
    .gte('issue_date', range.from)
    .lte('issue_date', range.to);
  if (countError || count == null) throw new Error('Could not load invoices');
  if (count > MAX_INVOICES_PER_ZIP) return { ok: false, error: 'too_many', invoiceCount: count };

  const [business, money] = await Promise.all([
    businessName(admin, p.tenantId),
    loadMoney(admin, p.tenantId, range, p.audience),
  ]);
  const notes: string[] = [];
  const files: PackFile[] = [];

  // Receipt photos, a few at a time. One that can't be fetched is marked, never fatal.
  const withReceipts = money.expenses.filter((e) => e.receiptPath);
  const fetched = await mapLimit(withReceipts, CONCURRENCY, async (e) => {
    try {
      return { e, bytes: await deps.downloadReceipt(e.receiptPath as string) };
    } catch {
      return { e, bytes: null };
    }
  });
  for (const { e, bytes } of fetched) {
    if (!bytes) {
      e.receiptFile = 'missing';
      continue;
    }
    const name = `receipts/${e.spentOn}-${slug(e.merchant ?? 'receipt')}-${e.id.slice(0, 6)}.${extensionOf(e.receiptPath as string)}`;
    e.receiptFile = name;
    files.push({ name, bytes });
  }
  const missing = fetched.filter((f) => !f.bytes).length;
  if (missing > 0) notes.push(`${missing} receipt ${missing === 1 ? 'photo' : 'photos'} couldn’t be fetched and ${missing === 1 ? 'is' : 'are'} marked "missing" in expenses.csv.`);

  // Invoice PDFs, a few at a time. One that fails to draw is noted, never fatal.
  const rendered = await mapLimit(money.invoices, CONCURRENCY, async (inv) => {
    try {
      return { inv, bytes: await deps.renderPdf(inv) };
    } catch {
      return { inv, bytes: null };
    }
  });
  for (const { inv, bytes } of rendered) {
    if (bytes) files.push({ name: `invoices/${inv.number.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`, bytes });
    else notes.push(`Couldn’t make ${inv.number}.pdf — open it in WorkWise.`);
  }

  const csvs = moneyCsvs(money, p.audience);
  const contents = [
    ...csvs.map((f) => CONTENTS[f.name]).filter(Boolean),
    'receipts/: the photo or PDF of each expense’s receipt (named by date and supplier).',
    'invoices/: each invoice as a PDF.',
  ];
  csvs.push(
    readmeText({ business, downloadedOn: todayInLondon(), audience: p.audience, periodLabel: range.label, contents, notes }),
  );

  const text = csvs.map((f) => ({ name: f.name, bytes: strToU8(f.content) }));
  return { ok: true, files: [...text, ...files], periodLabel: range.label };
}

