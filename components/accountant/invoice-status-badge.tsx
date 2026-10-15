import { Tag, type Tone } from '@/components/look';
import type { InvoiceStatusLabel } from '@/lib/invoices/status';

// Colour carries the meaning (paid / waiting / late / void), the word carries it for everyone else.
const TONES: Record<InvoiceStatusLabel, Tone> = {
  Paid: 'emerald',
  Unpaid: 'amber',
  Overdue: 'rose',
  Cancelled: 'slate',
};

export function InvoiceStatusBadge({ status, className }: { status: InvoiceStatusLabel; className?: string }) {
  return (
    <Tag tone={TONES[status]} className={className}>
      {status}
    </Tag>
  );
}
