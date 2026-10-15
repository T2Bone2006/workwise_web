import type { InvoiceRecord } from '@/lib/data/payments/invoices';

export type InvoiceStatusLabel = 'Paid' | 'Overdue' | 'Unpaid' | 'Cancelled';

/** The one rule for an invoice's status, used by the dashboard and the accountant pages. */
export function invoiceStatus(
  invoice: Pick<InvoiceRecord, 'status' | 'balanceDue' | 'isOverdue'>,
): InvoiceStatusLabel {
  if (invoice.status === 'void') return 'Cancelled';
  if (invoice.balanceDue <= 0) return 'Paid';
  if (invoice.isOverdue) return 'Overdue';
  return 'Unpaid';
}
