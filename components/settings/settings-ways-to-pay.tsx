import { Banknote, CreditCard, Landmark, Repeat } from 'lucide-react';
import { IconChip, Tag, type Tone } from '@/components/look';
import type { ConnectStatus } from '@/lib/payments/connect-status';
import type { DirectDebitState } from '@/lib/direct-debit/state';

type Way = { key: string; name: string; line: string; icon: typeof Landmark; status: string; tone: Tone };

/** One glance at which ways customers can pay you right now. Read-only: each way is set up in the cards below. */
export function SettingsWaysToPay({
  card,
  directDebit,
  bankSet,
}: {
  card: ConnectStatus;
  directDebit: DirectDebitState;
  bankSet: boolean;
}) {
  const ways: Way[] = [
    {
      key: 'card',
      name: 'Cards',
      line: 'Card, Apple Pay and Google Pay on your pay page',
      icon: CreditCard,
      ...(card === 'active'
        ? { status: 'On', tone: 'emerald' as const }
        : card === 'in_progress'
          ? { status: 'Checking', tone: 'sky' as const }
          : card === 'restricted'
            ? { status: 'Needs you', tone: 'amber' as const }
            : { status: 'Off', tone: 'slate' as const }),
    },
    {
      key: 'dd',
      name: 'Direct Debit',
      line: 'Collected after each visit through GoCardless',
      icon: Repeat,
      ...(directDebit === 'on'
        ? { status: 'On', tone: 'emerald' as const }
        : directDebit === 'verifying'
          ? { status: 'Checking', tone: 'sky' as const }
          : directDebit === 'needs_details'
            ? { status: 'Needs you', tone: 'amber' as const }
            : { status: 'Off', tone: 'slate' as const }),
    },
    {
      key: 'bank',
      name: 'Bank transfer',
      line: 'Your account details on invoices and the pay page',
      icon: Banknote,
      ...(bankSet ? { status: 'On', tone: 'emerald' as const } : { status: 'Needs you', tone: 'amber' as const }),
    },
  ];

  return (
    <section aria-label="Ways customers can pay you" className="grid gap-3 sm:grid-cols-3">
      {ways.map((way) => (
        <div
          key={way.key}
          className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 rounded-2xl border border-border bg-card p-4 shadow-(--look-card-shadow) sm:grid-cols-2 sm:gap-y-2"
        >
          <span className="sm:row-start-1">
            <IconChip icon={way.icon} tone={way.tone} size="sm" />
          </span>
          <span className="min-w-0 sm:col-span-2 sm:row-start-2">
            <span className="block text-[15px] font-semibold">{way.name}</span>
            <span className="block text-xs text-muted-foreground">{way.line}</span>
          </span>
          <span className="sm:col-start-2 sm:row-start-1 sm:justify-self-end">
            <Tag tone={way.tone}>{way.status}</Tag>
          </span>
        </div>
      ))}
    </section>
  );
}
