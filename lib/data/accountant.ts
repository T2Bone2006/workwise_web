import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { isExpenseCategory, type ExpenseCategory } from '@/lib/books/categories';
import { londonDateOf, taxYearFor, type PeriodRange } from '@/lib/books/periods';
import {
  assembleInvoices,
  getInvoice,
  INVOICE_COLUMNS,
  type InvoiceRecord,
} from '@/lib/data/payments/invoices';
import { readAllPages } from '@/lib/data/read-all-pages';
import { invoiceStatus, type InvoiceStatusLabel } from '@/lib/invoices/status';
import { fromPence, toPence } from '@/lib/money/pence';
import { londonDayBoundsUtc, todayInLondon, type Ymd } from '@/lib/rounds/dates';

/*
 * Read-only loaders for the accountant pages (D6, T8; revised 2026-10-01). These run with the
 * service-role client, so RLS does NOT protect them: every query below adds
 * `.eq('tenant_id', tenantId)`, and `tenantId` is only ever `ctx.tenantId` from
 * `requireAccountant`. Customers are only ever read by `name`. Invoices are the
 * business's own paperwork and are shown as issued (the owner's decision: an
 * accountant sees them in real life too), but there is no customer list and no
 * phone, email, notes or address browsing.
 */

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export type AccountantExpense = {
  id: string;
  spentOn: Ymd;
  merchant: string | null;
  category: ExpenseCategory;
  amount: number;
  vatAmount: number | null;
  hasReceipt: boolean;
};

/** Confirmed expenses only: a To check draft is never shown. */
export async function accountantExpenses(
  admin: SupabaseClient,
  tenantId: string,
  range: Pick<PeriodRange, 'from' | 'to'>,
): Promise<AccountantExpense[]> {
  const rows = await readAllPages(
    (from, to) =>
      admin
        .from('expenses')
        .select('id, spent_on, merchant, category, amount, vat_amount, receipt_path')
        .eq('tenant_id', tenantId)
        .eq('status', 'confirmed')
        .gte('spent_on', range.from)
        .lte('spent_on', range.to)
        .order('spent_on', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to),
    'Could not load expenses',
  );
  return rows.flatMap((r) =>
    typeof r.spent_on === 'string' && isExpenseCategory(r.category)
      ? [
          {
            id: String(r.id),
            spentOn: r.spent_on,
            merchant: typeof r.merchant === 'string' && r.merchant ? r.merchant : null,
            category: r.category,
            amount: num(r.amount),
            vatAmount: r.vat_amount == null ? null : num(r.vat_amount),
            hasReceipt: typeof r.receipt_path === 'string' && r.receipt_path !== '',
          },
        ]
      : [],
  );
}

export type AccountantInvoiceRow = {
  id: string;
  number: string;
  issueDate: Ymd;
  dueDate: Ymd;
  customerName: string;
  total: number;
  vatAmount: number;
  paid: number;
  balance: number;
  status: InvoiceStatusLabel;
};

/** Invoices issued in the range, each with its real status, paid and balance. */
export async function accountantInvoices(
  admin: SupabaseClient,
  tenantId: string,
  range: Pick<PeriodRange, 'from' | 'to'>,
): Promise<AccountantInvoiceRow[]> {
  const rows = await readAllPages(
    (from, to) =>
      admin
        .from('invoices')
        .select(INVOICE_COLUMNS)
        .eq('tenant_id', tenantId)
        .gte('issue_date', range.from)
        .lte('issue_date', range.to)
        .order('issue_date', { ascending: false })
        .order('number', { ascending: false })
        .range(from, to),
    'Could not load invoices',
  );
  const records = await assembleInvoices(admin, rows);
  return records.map((inv) => ({
    id: inv.id,
    number: inv.number,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    customerName: inv.billTo.name,
    total: inv.total,
    vatAmount: inv.vatAmount,
    paid: inv.status === 'void' ? 0 : inv.paidNow,
    balance: inv.status === 'void' ? 0 : inv.balanceDue,
    status: invoiceStatus(inv),
  }));
}

export type AccountantInvoicePayment = { receivedOn: Ymd; method: string; amount: number };

/**
 * One invoice of this business, as issued, with the payments received against
 * it. Null when it isn't theirs. The tenant filter is on the invoice AND on the
 * payment allocations.
 */
export async function accountantInvoice(
  admin: SupabaseClient,
  tenantId: string,
  invoiceId: string,
): Promise<{ invoice: InvoiceRecord; payments: AccountantInvoicePayment[] } | null> {
  const invoice = await getInvoice(admin, tenantId, invoiceId);
  if (!invoice) return null;

  const jobIds = [...new Set(invoice.lines.map((l) => l.jobId).filter((j): j is string => j != null))];
  const byPayment = new Map<string, { receivedOn: Ymd; method: string; pence: number }>();
  for (let i = 0; i < jobIds.length; i += 80) {
    const { data, error } = await admin
      .from('payment_allocations')
      .select('payment_id, amount, payments(received_at, method, status)')
      .eq('tenant_id', tenantId)
      .in('job_id', jobIds.slice(i, i + 80));
    if (error) throw new Error('Could not load the invoice.');
    for (const raw of (data ?? []) as Array<Record<string, unknown>>) {
      const embed = raw.payments;
      const pay = (Array.isArray(embed) ? embed[0] : embed) as
        | { received_at?: string; method?: string; status?: string }
        | null
        | undefined;
      if (!pay || pay.status !== 'active' || !pay.received_at) continue;
      const id = String(raw.payment_id);
      const entry = byPayment.get(id) ?? {
        receivedOn: londonDateOf(pay.received_at),
        method: String(pay.method ?? 'other'),
        pence: 0,
      };
      entry.pence += toPence(num(raw.amount));
      byPayment.set(id, entry);
    }
  }
  const payments = [...byPayment.values()]
    .map((p) => ({ receivedOn: p.receivedOn, method: p.method, amount: fromPence(p.pence) }))
    .sort((a, b) => a.receivedOn.localeCompare(b.receivedOn));
  return { invoice, payments };
}

export type AccountantPayment = {
  id: string;
  receivedOn: Ymd;
  customerName: string;
  amount: number;
  refunded: number;
  method: string;
};

/** Active payments only, by the London day they arrived. */
export async function accountantPayments(
  admin: SupabaseClient,
  tenantId: string,
  range: Pick<PeriodRange, 'from' | 'to'>,
): Promise<AccountantPayment[]> {
  const startIso = londonDayBoundsUtc(range.from).startIso;
  const endIso = londonDayBoundsUtc(range.to).endIso;
  const rows = await readAllPages(
    (from, to) =>
      admin
        .from('payments')
        .select('id, amount, refunded_amount, received_at, method, customers(name)')
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .gte('received_at', startIso)
        .lt('received_at', endIso)
        .order('received_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to),
    'Could not load payments',
  );
  return rows.map((r) => {
    const embed = r.customers;
    const customer = (Array.isArray(embed) ? embed[0] : embed) as { name?: unknown } | null | undefined;
    return {
      id: String(r.id),
      receivedOn: londonDateOf(String(r.received_at)),
      customerName: typeof customer?.name === 'string' ? customer.name : '',
      amount: num(r.amount),
      refunded: num(r.refunded_amount),
      method: String(r.method ?? 'other'),
    };
  });
}

/** The oldest tax year worth offering: the business's first, or last year if it started this year. */
export async function accountantEarliestTaxYear(admin: SupabaseClient, tenantId: string): Promise<number> {
  const today = todayInLondon();
  const { data } = await admin.from('tenants').select('created_at').eq('id', tenantId).maybeSingle();
  const created = (data as { created_at?: string } | null)?.created_at;
  const createdYear = created ? taxYearFor(londonDateOf(created)) : taxYearFor(today);
  return Math.min(createdYear, taxYearFor(today) - 1);
}

/** The storage path of a confirmed expense's receipt, only if it belongs to this business. */
export async function accountantReceiptPath(
  admin: SupabaseClient,
  tenantId: string,
  expenseId: string,
): Promise<string | null> {
  const { data } = await admin
    .from('expenses')
    .select('receipt_path')
    .eq('id', expenseId)
    .eq('tenant_id', tenantId)
    .eq('status', 'confirmed')
    .maybeSingle();
  const path = (data as { receipt_path?: string | null } | null)?.receipt_path;
  return path || null;
}

export type AccountantFlags = {
  /** Saved expenses in the period with no receipt photo. */
  noReceipt: { count: number; amount: number };
  /** Scanned receipts the trader hasn't checked yet: not counted anywhere. Not limited to the period. */
  unchecked: number;
  /** Payments in the period that were given back, in full or in part. */
  refundedInFull: { count: number; amount: number };
  refundedInPart: { count: number; amount: number };
  /** What customers owe the business today (not at the end of the period). */
  owed: { amount: number; customers: number };
};

/** The "worth a look" box on the front page: things an accountant would want to ask about. */
export async function accountantFlags(
  admin: SupabaseClient,
  tenantId: string,
  range: Pick<PeriodRange, 'from' | 'to'>,
): Promise<AccountantFlags> {
  const startIso = londonDayBoundsUtc(range.from).startIso;
  const endIso = londonDayBoundsUtc(range.to).endIso;

  const [noReceiptRows, drafts, refundRows, owedRows] = await Promise.all([
    readAllPages(
      (from, to) =>
        admin
          .from('expenses')
          .select('id, amount')
          .eq('tenant_id', tenantId)
          .eq('status', 'confirmed')
          .is('receipt_path', null)
          .gte('spent_on', range.from)
          .lte('spent_on', range.to)
          .order('id', { ascending: true })
          .range(from, to),
      'Could not load expenses',
    ),
    admin
      .from('expenses')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'draft'),
    readAllPages(
      (from, to) =>
        admin
          .from('payments')
          .select('id, amount, refunded_amount')
          .eq('tenant_id', tenantId)
          .eq('status', 'active')
          .gt('refunded_amount', 0)
          .gte('received_at', startIso)
          .lt('received_at', endIso)
          .order('id', { ascending: true })
          .range(from, to),
      'Could not load payments',
    ),
    readAllPages(
      (from, to) =>
        admin
          .from('customer_balances')
          .select('customer_id, owed_amount')
          .eq('tenant_id', tenantId)
          .gt('owed_amount', 0)
          .order('customer_id', { ascending: true })
          .range(from, to),
      'Could not load balances',
    ),
  ]);
  if (drafts.error) throw new Error('Could not load expenses');

  const sum = (rows: Array<Record<string, unknown>>, key: string) =>
    fromPence(rows.reduce((total, r) => total + toPence(num(r[key])), 0));

  const full = refundRows.filter((r) => num(r.refunded_amount) >= num(r.amount));
  const part = refundRows.filter((r) => num(r.refunded_amount) < num(r.amount));

  return {
    noReceipt: { count: noReceiptRows.length, amount: sum(noReceiptRows, 'amount') },
    unchecked: drafts.count ?? 0,
    refundedInFull: { count: full.length, amount: sum(full, 'refunded_amount') },
    refundedInPart: { count: part.length, amount: sum(part, 'refunded_amount') },
    owed: { amount: sum(owedRows, 'owed_amount'), customers: owedRows.length },
  };
}
