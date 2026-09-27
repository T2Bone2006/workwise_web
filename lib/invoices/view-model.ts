import { formatGbp } from '@/lib/money/pence';
import { formatSortCode } from '@/lib/payments/bank-format';
import type { InvoiceRecord } from '@/lib/data/payments/invoices';

export type InvoiceViewModel = {
  title: 'INVOICE';
  number: string;
  issueDate: string;
  dueDate: string;
  stamp: 'PAID' | 'VOID' | 'OVERDUE' | null;
  seller: {
    name: string;
    lines: string[];
    logoUrl: string | null;
    vatLine: string | null;
  };
  billTo: { lines: string[] };
  rows: { date: string; description: string; address: string; amount: string }[];
  totals: { label: string; value: string; strong?: boolean }[];
  howToPay: {
    cardUrl: string | null;
    bankLines: { label: string; value: string }[] | null;
    reference: string | null;
  };
  footer: string | null;
};

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

function formatLongDate(ymd: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!match) return ymd;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return ymd;
  return `${Number(match[3])} ${month} ${match[1]}`;
}

function formatRowDate(ymd: string | null): string {
  if (!ymd) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!match) return ymd;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return ymd;
  return `${Number(match[3])} ${month}`;
}

function splitAddress(address: string | null): string[] {
  if (!address) return [];
  return address
    .split(/[,\n]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function money(pounds: number): string {
  return formatGbp(pounds, { always2dp: true });
}

function vatLabel(rate: number): string {
  const shown = Number.isInteger(rate) ? String(rate) : String(Math.round(rate * 100) / 100);
  return `VAT ${shown}%`;
}

function stampFor(inv: InvoiceRecord): InvoiceViewModel['stamp'] {
  if (inv.status === 'void') return 'VOID';
  if (inv.balanceDue <= 0) return 'PAID';
  if (inv.isOverdue) return 'OVERDUE';
  return null;
}

export function toInvoiceViewModel(
  inv: InvoiceRecord,
  opts: { cardUrl: string | null },
): InvoiceViewModel {
  const sellerLines = [
    ...splitAddress(inv.seller.address),
    ...(inv.seller.phone ? [inv.seller.phone] : []),
    ...(inv.seller.email ? [inv.seller.email] : []),
  ];

  const billToLines = [
    ...(inv.billTo.company ? [inv.billTo.company] : []),
    inv.billTo.name,
    ...splitAddress(inv.billTo.address),
    ...(inv.billTo.email ? [inv.billTo.email] : []),
  ];

  const totals: InvoiceViewModel['totals'] = [];
  if (inv.vatRatePercent != null) {
    totals.push({ label: 'Subtotal (excl. VAT)', value: money(inv.subtotalNet) });
    totals.push({ label: vatLabel(inv.vatRatePercent), value: money(inv.vatAmount) });
    totals.push({ label: 'Total', value: money(inv.total) });
  } else {
    totals.push({ label: 'Total', value: money(inv.total) });
  }
  if (inv.paidNow > 0) {
    totals.push({ label: 'Paid', value: money(-inv.paidNow) });
  }
  totals.push({ label: 'Balance due', value: money(inv.balanceDue), strong: true });

  const bankLines = inv.bank
    ? [
        { label: 'Name', value: inv.bank.accountName },
        {
          label: 'Sort code',
          value: formatSortCode(inv.bank.sortCode) || inv.bank.sortCode,
        },
        { label: 'Account', value: inv.bank.accountNumber },
      ]
    : null;

  return {
    title: 'INVOICE',
    number: inv.number,
    issueDate: formatLongDate(inv.issueDate),
    dueDate: formatLongDate(inv.dueDate),
    stamp: stampFor(inv),
    seller: {
      name: inv.seller.name,
      lines: sellerLines,
      logoUrl: inv.seller.logoUrl,
      vatLine: inv.seller.vatNumber ? `VAT no. ${inv.seller.vatNumber}` : null,
    },
    billTo: { lines: billToLines },
    rows: inv.lines.map((line) => ({
      date: formatRowDate(line.serviceDate),
      description: line.description,
      address: line.address ?? '',
      amount: money(line.amount),
    })),
    totals,
    howToPay: {
      cardUrl: opts.cardUrl,
      bankLines,
      reference: inv.paymentReference,
    },
    footer: inv.footer,
  };
}
