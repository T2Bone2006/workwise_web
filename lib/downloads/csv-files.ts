import { EXPENSE_CATEGORY_HMRC, EXPENSE_CATEGORY_LABELS, type ExpenseCategory } from '@/lib/books/categories';
import { groupByHmrcHeading } from '@/lib/books/hmrc';
import type { BooksSummary } from '@/lib/books/summary-pure';
import { toCsv, whole, type CsvCell } from '@/lib/downloads/csv';
import { paymentMethodLabel } from '@/lib/payments/method-labels';

/*
 * The spreadsheets, from rows already loaded. Pure, so the columns are tested.
 * The accountant's copy never has a customer list, schedules or visits, and no
 * file in it has a phone, email, address, postcode or notes column.
 */

export type Audience = 'trader' | 'accountant';
export type CsvFile = { name: string; content: string };

const file = (name: string, headers: string[], rows: CsvCell[][]): CsvFile => ({ name, content: toCsv(headers, rows) });

// --- money files (the accountant gets these) ---

export type PaymentCsvRow = {
  receivedOn: string;
  customerName: string;
  amount: number;
  refunded: number;
  method: string;
  source: string;
  note: string | null;
};

export const PAYMENT_HEADERS = ['Date received', 'Customer', 'Amount', 'Refunded', 'Counted', 'Method', 'Source'];

export function paymentsCsv(rows: PaymentCsvRow[], audience: Audience): CsvFile {
  const headers = audience === 'trader' ? [...PAYMENT_HEADERS, 'Note'] : PAYMENT_HEADERS;
  return file(
    'payments.csv',
    headers,
    rows.map((r) => {
      const base: CsvCell[] = [
        r.receivedOn,
        r.customerName,
        r.amount,
        r.refunded,
        Math.max(0, Math.round((r.amount - r.refunded) * 100) / 100),
        paymentMethodLabel(r.method),
        r.source,
      ];
      return audience === 'trader' ? [...base, r.note] : base;
    }),
  );
}

export type ExpenseCsvRow = {
  spentOn: string;
  merchant: string | null;
  category: ExpenseCategory;
  amount: number;
  vatAmount: number | null;
  note: string | null;
  /** 'receipts/…' when the photo is in this download, 'missing' when it couldn't be fetched, '' when there is none. */
  receiptFile: string;
};

export const EXPENSE_HEADERS = ['Date', 'Supplier', 'Category', 'HMRC heading', 'Amount', 'VAT', 'Net'];

export function expensesCsv(rows: ExpenseCsvRow[], audience: Audience): CsvFile {
  const headers = audience === 'trader' ? [...EXPENSE_HEADERS, 'Note', 'Receipt file'] : [...EXPENSE_HEADERS, 'Receipt file'];
  return file(
    'expenses.csv',
    headers,
    rows.map((r) => {
      const base: CsvCell[] = [
        r.spentOn,
        r.merchant,
        EXPENSE_CATEGORY_LABELS[r.category],
        EXPENSE_CATEGORY_HMRC[r.category],
        r.amount,
        r.vatAmount,
        Math.round((r.amount - (r.vatAmount ?? 0)) * 100) / 100,
      ];
      return audience === 'trader' ? [...base, r.note, r.receiptFile] : [...base, r.receiptFile];
    }),
  );
}

export type InvoiceCsvRow = {
  number: string;
  issueDate: string;
  dueDate: string;
  customerName: string;
  net: number;
  vat: number;
  total: number;
  paid: number;
  balance: number;
  status: string;
};

export const INVOICE_HEADERS = ['Number', 'Issued', 'Due', 'Customer', 'Net', 'VAT', 'Total', 'Paid', 'Balance', 'Status'];

export function invoicesCsv(rows: InvoiceCsvRow[]): CsvFile {
  return file(
    'invoices.csv',
    INVOICE_HEADERS,
    rows.map((r) => [r.number, r.issueDate, r.dueDate, r.customerName, r.net, r.vat, r.total, r.paid, r.balance, r.status]),
  );
}

export type ChargeCsvRow = { date: string; customerName: string; description: string; amount: number; status: string };
export const CHARGE_HEADERS = ['Date', 'Customer', 'Description', 'Amount', 'Status'];

export function chargesCsv(rows: ChargeCsvRow[]): CsvFile {
  return file('other-amounts-owed.csv', CHARGE_HEADERS, rows.map((r) => [r.date, r.customerName, r.description, r.amount, r.status]));
}

export function summaryCsv(summary: BooksSummary): CsvFile {
  const rows: CsvCell[][] = [
    ['Period', summary.period.label],
    ['Money in', summary.moneyIn],
    ['Payments counted', whole(summary.paymentsCount)],
    ['Money out', summary.moneyOut],
    ['Left (money in less money out)', summary.left],
  ];
  if (summary.vat) {
    rows.push(['VAT on expenses', summary.vat.vatOut]);
    rows.push([`VAT in takings (estimate at ${summary.vat.rate}%)`, summary.vat.vatInEstimate]);
  }
  return file('summary.csv', ['Item', 'Amount'], rows);
}

export const HMRC_HEADERS = ['HMRC heading', 'WorkWise categories', 'Expenses', 'VAT', 'Total'];

export function expensesByHmrcCsv(summary: BooksSummary): CsvFile {
  return file(
    'expenses-by-hmrc-heading.csv',
    HMRC_HEADERS,
    groupByHmrcHeading(summary.moneyOutByCategory).map((g) => [g.heading, g.categories.join('; '), whole(g.count), g.vatAmount, g.amount]),
  );
}

export function inAndOutCsv(summary: BooksSummary): CsvFile | null {
  if (!summary.months) return null;
  return file(
    'in-and-out.csv',
    ['Month', 'Money in', 'Money out', 'Left'],
    summary.months.map((m) => [m.label, m.moneyIn, m.moneyOut, Math.round((m.moneyIn - m.moneyOut) * 100) / 100]),
  );
}

// --- the business's own files (never in the accountant's copy) ---

export type CustomerCsvRow = {
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  paymentTerms: string | null;
  accessNotes: string | null;
  notes: string | null;
  active: boolean;
};

export const CUSTOMER_HEADERS = ['Name', 'Company', 'Phone', 'Email', 'Address', 'Payment terms', 'Access notes', 'Notes', 'Active'];

export function customersCsv(rows: CustomerCsvRow[]): CsvFile {
  return file(
    'customers.csv',
    CUSTOMER_HEADERS,
    rows.map((r) => [r.name, r.company, r.phone, r.email, r.address, r.paymentTerms, r.accessNotes, r.notes, r.active ? 'Yes' : 'No']),
  );
}

export type ScheduleCsvRow = {
  customerName: string;
  service: string;
  price: number;
  everyDays: number;
  nextDue: string | null;
  status: string;
  preferredWeekday: number | null;
  address: string | null;
  postcode: string | null;
};

const WEEKDAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const SCHEDULE_HEADERS = ['Customer', 'Service', 'Price', 'Every (days)', 'Next due', 'Status', 'Preferred day', 'Address', 'Postcode'];

export function schedulesCsv(rows: ScheduleCsvRow[]): CsvFile {
  return file(
    'schedules.csv',
    SCHEDULE_HEADERS,
    rows.map((r) => [r.customerName, r.service, r.price, whole(r.everyDays), r.nextDue, r.status, r.preferredWeekday ? WEEKDAYS[r.preferredWeekday] : '', r.address, r.postcode]),
  );
}

export type VisitCsvRow = {
  date: string | null;
  customerName: string;
  service: string;
  status: string;
  price: number | null;
  paidStatus: string | null;
  skipReason: string | null;
};

export const VISIT_HEADERS = ['Date', 'Customer', 'Service', 'Status', 'Price', 'Paid status', 'Skip reason'];

export function visitsCsv(rows: VisitCsvRow[]): CsvFile {
  return file(
    'visits.csv',
    VISIT_HEADERS,
    rows.map((r) => [r.date, r.customerName, r.service, r.status, r.price, r.paidStatus, r.skipReason]),
  );
}

// --- the note that goes in every download ---

export function readmeText(p: {
  business: string;
  downloadedOn: string;
  audience: Audience;
  /** e.g. '2026/27 tax year', or null for everything. */
  periodLabel: string | null;
  contents: string[];
  notes?: string[];
}): CsvFile {
  const lines = [
    `Downloaded from WorkWise on ${p.downloadedOn} for ${p.business}.`,
    p.periodLabel ? `Period: ${p.periodLabel}.` : 'Period: everything in WorkWise.',
    '',
    'How the numbers are counted',
    '- Money in is counted on the day it arrived (cash basis), after any refunds.',
    '- Expenses are counted on the day they were spent. Only expenses the business has saved are included; ones still waiting to be checked are not.',
    '- Amounts are in pounds. Expense amounts include VAT; the VAT column shows how much of that is VAT.',
    '- Dates are YYYY-MM-DD.',
    '- Open the .csv files in Excel, Numbers or Google Sheets.',
    '',
    'What is in this download',
    ...p.contents.map((c) => `- ${c}`),
  ];
  if (p.audience === 'accountant') {
    lines.push('', 'This is a read-only copy for the accountant: it has no customer list, schedules or visit history.');
  }
  if (p.notes && p.notes.length > 0) lines.push('', 'Things to know', ...p.notes.map((n) => `- ${n}`));
  return { name: 'README.txt', content: lines.join('\n') + '\n' };
}

