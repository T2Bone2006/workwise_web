import { Banknote, Landmark } from 'lucide-react';
import type { BooksSummary } from '@/lib/books/summary-pure';
import type { TrendMonth } from '@/lib/books/trend';
import type { LatestPayment } from '@/lib/data/rounds/overview';
import { formatGbp } from '@/lib/money/pence';
import { paymentMethodLabel } from '@/lib/payments/method-labels';
import { cn } from '@/lib/utils';
import { MoneyChart } from './money-chart';
import { formatDayMonth, SectionCard } from './shared';

function Figure({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className="rounded-xl bg-muted/40 px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 text-lg font-semibold tabular-nums', className)}>{formatGbp(value)}</p>
    </div>
  );
}

function when(receivedOn: string, today: string): string {
  if (receivedOn === today) return 'Today';
  return formatDayMonth(receivedOn);
}

/**
 * The money side at a glance: this month's in, out and left; the last six months
 * as a chart; and the latest payments to land.
 */
export function MoneyCard({
  today,
  books,
  trend,
  latest,
}: {
  today: string;
  books: BooksSummary | null;
  trend: TrendMonth[] | null;
  latest: LatestPayment[] | null;
}) {
  const month = books?.period.label.split(' ')[0] ?? 'This month';
  const hasHistory = (trend ?? []).some((m) => m.moneyIn > 0 || m.moneyOut > 0);

  return (
    <SectionCard
      icon={Banknote}
      tone="emerald"
      title="Money"
      summary={`${month} so far, and the last six months`}
      action={{ href: '/expenses?tab=in-out', label: 'In and out' }}
      labelledBy="money-heading"
    >
      {books ? (
        <div className="grid grid-cols-3 gap-2">
          <Figure label="In" value={books.moneyIn} className="text-emerald-700 dark:text-emerald-300" />
          <Figure label="Out" value={books.moneyOut} className="text-rose-700 dark:text-rose-300" />
          <Figure
            label="Left"
            value={books.left}
            className={books.left < 0 ? 'text-rose-700 dark:text-rose-300' : undefined}
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Couldn&apos;t work out this month&apos;s money.</p>
      )}

      {trend && hasHistory ? (
        <div>
          <div className="mb-1 flex items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-emerald-500" aria-hidden="true" /> Money in
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-rose-500" aria-hidden="true" /> Money out
            </span>
          </div>
          <MoneyChart months={trend} />
        </div>
      ) : trend ? (
        <p className="rounded-xl border border-dashed border-border/80 px-4 py-6 text-center text-sm text-muted-foreground">
          Once payments and expenses come in, you&apos;ll see the last six months here.
        </p>
      ) : null}

      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Landmark className="size-3.5" aria-hidden="true" /> Latest payments
        </p>
        {latest == null ? (
          <p className="text-sm text-muted-foreground">Couldn&apos;t load payments.</p>
        ) : latest.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payments yet.</p>
        ) : (
          <ul className="divide-y divide-border/60 rounded-xl border border-border/60">
            {latest.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{p.customerName}</span>
                  <span className="text-muted-foreground"> · {paymentMethodLabel(p.method)}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{when(p.receivedOn, today)}</span>
                <span className="w-16 shrink-0 text-right font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
                  +{formatGbp(p.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}
