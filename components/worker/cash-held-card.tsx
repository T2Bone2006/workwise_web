import { Banknote } from 'lucide-react';
import { LookCard } from '@/components/look';
import { formatGbp } from '@/lib/money/pence';

/** "Cash I'm holding": what a lead has taken in cash or cheque and hasn't handed over yet. Reading only. */
export function CashHeldCard({ total, count, handTo }: { total: number; count: number; handTo: string | null }) {
  return (
    <LookCard title="Cash I'm holding" icon={Banknote} tone="rose">
      <p className="text-2xl font-semibold tracking-tight text-(--tone-rose-text) tabular-nums">{formatGbp(total)}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        From {count} {count === 1 ? 'payment' : 'payments'}. Hand it to {handTo ?? 'your employer'}; they tick it off once you have.
      </p>
    </LookCard>
  );
}
