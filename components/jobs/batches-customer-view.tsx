'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { type ImportBatchRow } from '@/lib/data/jobs';
import { cn } from '@/lib/utils';
import { format, parseISO, isValid } from 'date-fns';
import { Building2, FolderInput } from 'lucide-react';

interface BatchesCustomerViewProps {
  batches: ImportBatchRow[];
}

interface CustomerGroup {
  /** Null groups legacy imports with no resolvable customer (pre-dates
   *  customer-scoped import sources) — kept distinct from the "Manually
   *  added" tile below, which is jobs with no import at all. */
  customerId: string | null;
  customerName: string;
  batchCount: number;
  liveJobTotal: number;
  latestStartedAt: string | null;
}

function liveTotalOf(batch: ImportBatchRow): number {
  return (
    batch.pending +
    batch.pending_send +
    batch.assigned +
    batch.in_progress +
    batch.paused +
    batch.completed
  );
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = parseISO(value);
    if (!isValid(parsed)) return null;
    return format(parsed, 'd MMM yyyy');
  } catch {
    return null;
  }
}

/**
 * Top level of the Batches tab: one card per customer (grouping that
 * customer's import batches), plus a "Manually added" card for jobs with no
 * import at all. Clicking a customer drills into their batches — see
 * BatchesView, rendered by jobs-table for that next level.
 */
export function BatchesCustomerView({ batches }: BatchesCustomerViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const manualBatch = batches.find((b) => b.id === 'ungrouped') ?? null;
  const importedBatches = batches.filter((b) => b.id !== 'ungrouped');

  const groupsByKey = new Map<string, CustomerGroup>();
  for (const batch of importedBatches) {
    const key = batch.customer_id ?? '__no_customer__';
    const liveTotal = liveTotalOf(batch);
    const existing = groupsByKey.get(key);
    if (existing) {
      existing.batchCount += 1;
      existing.liveJobTotal += liveTotal;
      if ((batch.started_at ?? '') > (existing.latestStartedAt ?? '')) {
        existing.latestStartedAt = batch.started_at;
      }
    } else {
      groupsByKey.set(key, {
        customerId: batch.customer_id,
        customerName: batch.customer_name ?? 'No customer',
        batchCount: 1,
        liveJobTotal: liveTotal,
        latestStartedAt: batch.started_at,
      });
    }
  }
  const groups = [...groupsByKey.values()].sort((a, b) =>
    (b.latestStartedAt ?? '').localeCompare(a.latestStartedAt ?? '')
  );

  const goToCustomer = (customerId: string | null) => {
    const next = new URLSearchParams(searchParams.toString());
    if (customerId) next.set('customer_id', customerId);
    else next.delete('customer_id');
    next.delete('page');
    router.push(`/jobs?${next.toString()}`, { scroll: false });
  };

  const goToManual = () => {
    const next = new URLSearchParams(searchParams.toString());
    next.set('batchId', 'ungrouped');
    next.delete('page');
    router.push(`/jobs?${next.toString()}`, { scroll: false });
  };

  if (groups.length === 0 && !manualBatch) {
    return (
      <div className="rounded-xl border border-border/70 bg-muted/20 p-6 text-sm text-muted-foreground">
        No import batches found.
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {groups.map((group) => {
        const dateLabel = formatDate(group.latestStartedAt);
        return (
          <Card
            key={group.customerId ?? '__no_customer__'}
            className={cn(
              'glass-card cursor-pointer overflow-hidden border-border/80 p-4 transition-all duration-300',
              'hover:bg-muted/30 backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
            )}
            onClick={() => goToCustomer(group.customerId)}
          >
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {group.customerName}
                  </p>
                  {dateLabel && (
                    <p className="mt-1 text-xs text-muted-foreground">Last import {dateLabel}</p>
                  )}
                </div>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Building2 className="size-4" strokeWidth={2} />
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground tabular-nums">
                  {group.liveJobTotal}
                </span>{' '}
                {group.liveJobTotal === 1 ? 'job' : 'jobs'}
                {' · '}
                <span className="tabular-nums">{group.batchCount}</span>{' '}
                {group.batchCount === 1 ? 'batch' : 'batches'}
              </p>
            </div>
          </Card>
        );
      })}
      {manualBatch && (
        <Card
          key="manual"
          className={cn(
            'glass-card cursor-pointer overflow-hidden border-border/80 border-dashed p-4 transition-all duration-300',
            'hover:bg-muted/30 backdrop-blur-[var(--blur-glass)]'
          )}
          onClick={goToManual}
        >
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">Manually added</p>
                <p className="mt-1 text-xs text-muted-foreground">Not from a spreadsheet import</p>
              </div>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <FolderInput className="size-4" strokeWidth={2} />
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground tabular-nums">
                {liveTotalOf(manualBatch)}
              </span>{' '}
              {liveTotalOf(manualBatch) === 1 ? 'job' : 'jobs'}
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
