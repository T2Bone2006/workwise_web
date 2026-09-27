import { renderToBuffer } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { invoiceDocument } from '@/lib/invoices/pdf/invoice-document';
import type { InvoiceViewModel } from '@/lib/invoices/view-model';

const vm: InvoiceViewModel = {
  title: 'INVOICE',
  number: 'INV-0042',
  issueDate: '24 Sep 2026',
  dueDate: '8 Oct 2026',
  stamp: 'OVERDUE',
  seller: {
    name: 'Green Gardens',
    lines: ['1 High Street', 'London'],
    logoUrl: null,
    vatLine: 'VAT no. GB123456789',
  },
  billTo: { lines: ['Smith Ltd', 'Jane Smith'] },
  rows: [
    {
      date: '24 Sep',
      description: 'Lawn cut',
      address: '2 Low Road, Bath',
      amount: '£18.00',
    },
  ],
  totals: [
    { label: 'Subtotal (excl. VAT)', value: '£15.00' },
    { label: 'VAT 20%', value: '£3.00' },
    { label: 'Total', value: '£18.00' },
    { label: 'Balance due', value: '£18.00', strong: true },
  ],
  howToPay: {
    cardUrl: null,
    bankLines: [
      { label: 'Name', value: 'Green Gardens' },
      { label: 'Sort code', value: '12-34-56' },
      { label: 'Account', value: '12345678' },
    ],
    reference: 'SMITH42',
  },
  footer: 'Thank you',
};

describe('invoiceDocument', () => {
  it('renders a PDF buffer', async () => {
    const pdf = await renderToBuffer(invoiceDocument(vm, null));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
