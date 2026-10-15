import { describe, expect, it } from 'vitest';
import type { InvoiceRecord } from '@/lib/data/payments/invoices';
import { toInvoiceViewModel } from '@/lib/invoices/view-model';

function invoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'inv-1',
    tenantId: 'tenant-1',
    customerId: 'customer-1',
    number: 'INV-0042',
    kind: 'visit',
    status: 'issued',
    issueDate: '2026-09-24',
    dueDate: '2026-10-08',
    seller: {
      name: 'Green Gardens',
      address: '1 High Street, London\nSW1A 1AA',
      phone: '07700 900000',
      email: 'hello@green.test',
      logoUrl: null,
      vatNumber: 'GB123456789',
    },
    billTo: {
      name: 'Jane Smith',
      company: 'Smith Ltd',
      address: '2 Low Road, Bath',
      email: 'jane@smith.test',
    },
    bank: {
      accountName: 'Green Gardens',
      sortCode: '123456',
      accountNumber: '12345678',
    },
    paymentReference: 'SMITH42',
    vatRatePercent: 20,
    subtotalNet: 15,
    vatAmount: 3,
    total: 18,
    footer: 'Thank you',
    publicToken: 'a'.repeat(32),
    sentAt: null,
    sentToEmail: null,
    voidedAt: null,
    voidReason: null,
    lines: [
      {
        jobId: 'job-1',
        serviceDate: '2026-09-24',
        description: 'Lawn cut',
        address: '2 Low Road, Bath',
        amount: 18,
      },
    ],
    paidNow: 0,
    balanceDue: 18,
    isOverdue: false,
    ...overrides,
  };
}

describe('toInvoiceViewModel', () => {
  it('builds VAT totals rows', () => {
    const vm = toInvoiceViewModel(invoice(), { cardUrl: 'https://pay.example/i/abc' });
    expect(vm.issueDate).toBe('24 Sep 2026');
    expect(vm.dueDate).toBe('8 Oct 2026');
    expect(vm.rows[0]).toEqual({
      date: '24 Sep',
      description: 'Lawn cut',
      address: '2 Low Road, Bath',
      amount: '£18.00',
    });
    expect(vm.totals).toEqual([
      { label: 'Subtotal (excl. VAT)', value: '£15.00' },
      { label: 'VAT 20%', value: '£3.00' },
      { label: 'Total', value: '£18.00' },
      { label: 'Balance due', value: '£18.00', strong: true },
    ]);
    expect(vm.seller.vatLine).toBe('VAT no. GB123456789');
  });

  it('builds non-VAT totals rows', () => {
    const vm = toInvoiceViewModel(
      invoice({
        vatRatePercent: null,
        subtotalNet: 18,
        vatAmount: 0,
        seller: {
          name: 'Green Gardens',
          address: null,
          phone: null,
          email: null,
          logoUrl: null,
          vatNumber: null,
        },
      }),
      { cardUrl: null },
    );
    expect(vm.totals).toEqual([
      { label: 'Total', value: '£18.00' },
      { label: 'Balance due', value: '£18.00', strong: true },
    ]);
    expect(vm.seller.vatLine).toBeNull();
  });

  it('marks a paid invoice PAID with a zero balance', () => {
    const vm = toInvoiceViewModel(
      invoice({ paidNow: 18, balanceDue: 0, isOverdue: false }),
      { cardUrl: null },
    );
    expect(vm.stamp).toBe('PAID');
    expect(vm.totals).toContainEqual({ label: 'Paid', value: '\u2212£18.00' });
    expect(vm.totals.at(-1)).toEqual({
      label: 'Balance due',
      value: '£0.00',
      strong: true,
    });
  });

  it('marks a void invoice VOID', () => {
    const vm = toInvoiceViewModel(
      invoice({ status: 'void', voidedAt: '2026-09-25T10:00:00Z', balanceDue: 18 }),
      { cardUrl: null },
    );
    expect(vm.stamp).toBe('VOID');
  });

  it('marks an overdue invoice OVERDUE', () => {
    const vm = toInvoiceViewModel(invoice({ isOverdue: true }), { cardUrl: null });
    expect(vm.stamp).toBe('OVERDUE');
  });

  it('has no bank and no card, so the PDF shows the contact line', () => {
    const vm = toInvoiceViewModel(
      invoice({ bank: null, paymentReference: null }),
      { cardUrl: null },
    );
    expect(vm.howToPay.cardUrl).toBeNull();
    expect(vm.howToPay.bankLines).toBeNull();
    expect(vm.howToPay.reference).toBeNull();
  });

  it('splits addresses on commas and newlines', () => {
    const vm = toInvoiceViewModel(invoice(), { cardUrl: null });
    expect(vm.seller.lines).toEqual([
      '1 High Street',
      'London',
      'SW1A 1AA',
      '07700 900000',
      'hello@green.test',
    ]);
    expect(vm.billTo.lines).toEqual([
      'Smith Ltd',
      'Jane Smith',
      '2 Low Road',
      'Bath',
      'jane@smith.test',
    ]);
    expect(vm.howToPay.bankLines).toEqual([
      { label: 'Name', value: 'Green Gardens' },
      { label: 'Sort code', value: '12-34-56' },
      { label: 'Account', value: '12345678' },
    ]);
  });
});
