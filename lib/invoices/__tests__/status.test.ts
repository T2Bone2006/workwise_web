import { describe, expect, it } from 'vitest';
import { invoiceStatus } from '@/lib/invoices/status';

describe('invoiceStatus', () => {
  it('is Cancelled for a void invoice, whatever else is true', () => {
    expect(invoiceStatus({ status: 'void', balanceDue: 0, isOverdue: false })).toBe('Cancelled');
    expect(invoiceStatus({ status: 'void', balanceDue: 50, isOverdue: true })).toBe('Cancelled');
  });
  it('is Paid when nothing is left to pay', () => {
    expect(invoiceStatus({ status: 'issued', balanceDue: 0, isOverdue: false })).toBe('Paid');
  });
  it('is Overdue when money is owed past the due date, else Unpaid', () => {
    expect(invoiceStatus({ status: 'issued', balanceDue: 10, isOverdue: true })).toBe('Overdue');
    expect(invoiceStatus({ status: 'issued', balanceDue: 10, isOverdue: false })).toBe('Unpaid');
  });
});
