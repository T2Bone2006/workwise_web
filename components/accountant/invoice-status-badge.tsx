import type { InvoiceStatusLabel } from '@/lib/invoices/status';
import { cn } from '@/lib/utils';

// Colour carries the meaning (paid / waiting / late / void), the word carries it for everyone else.
const STYLES: Record<InvoiceStatusLabel, string> = {
  Paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  Unpaid: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300',
  Overdue: 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300',
  Cancelled: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300',
};

export function InvoiceStatusBadge({ status, className }: { status: InvoiceStatusLabel; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        STYLES[status],
        className,
      )}
    >
      {status}
    </span>
  );
}
