'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { type ImportBatchRow } from '@/lib/data/jobs';
import { JOB_STATUS_DISPLAY } from '@/lib/job-status-display';
import { cn } from '@/lib/utils';
import { format, parseISO, isValid } from 'date-fns';

interface BatchesViewProps {
  batches: ImportBatchRow[];
}

function formatBatchDate(value: string | null) {
  if (!value) return '—';
  try {
    const parsed = parseISO(value);
    if (!isValid(parsed)) return value;
    return format(parsed, 'd MMM yyyy');
  } catch {
    return value;
  }
}

export function BatchesView({ batches }: BatchesViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  if (batches.length === 0) {
    return (
      <div className="rounded-xl border border-border/70 bg-muted/20 p-6 text-sm text-muted-foreground">
        No import batches found.
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {batches.map((batch) => {
        const chips = [
          { n: batch.pending, title: 'Not Started', bar: JOB_STATUS_DISPLAY.pending.summaryBarClass },
          {
            n: batch.pending_send,
            title: 'Ready to send',
            bar: JOB_STATUS_DISPLAY.pending_send.summaryBarClass,
          },
          { n: batch.in_progress, title: 'In Progress', bar: JOB_STATUS_DISPLAY.in_progress.summaryBarClass },
          { n: batch.assigned, title: 'Assigned', bar: JOB_STATUS_DISPLAY.assigned.summaryBarClass },
          { n: batch.paused, title: 'Paused', bar: JOB_STATUS_DISPLAY.paused.summaryBarClass },
          { n: batch.completed, title: 'Completed', bar: JOB_STATUS_DISPLAY.completed.summaryBarClass },
        ];
        const liveTotal =
          batch.pending +
          batch.pending_send +
          batch.assigned +
          batch.in_progress +
          batch.paused +
          batch.completed;
        const total = Math.max(liveTotal, batch.rows_imported, 0);
        const completed = Math.max(batch.completed, 0);
        const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
        return (
          <Card
            key={batch.id}
            className={cn(
              'glass-card cursor-pointer overflow-hidden border-border/80 p-4 transition-all duration-300',
              'hover:bg-muted/30 backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
            )}
            onClick={() => {
              const next = new URLSearchParams(searchParams.toString());
              next.set('view', 'list');
              next.set('batchId', batch.id);
              next.delete('page');
              router.push(`/jobs?${next.toString()}`, { scroll: false });
            }}
          >
            <div className="space-y-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">
                  {batch.file_name ?? 'Unnamed import batch'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{formatBatchDate(batch.started_at)}</p>
              </div>
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground tabular-nums">{liveTotal}</span>{' '}
                {liveTotal === 1 ? 'job' : 'jobs'}
                {batch.rows_imported > liveTotal ? (
                  <span className="text-muted-foreground/80">
                    {' '}
                    ({batch.rows_imported} imported)
                  </span>
                ) : null}
              </p>
              <div className="flex flex-wrap gap-2 text-xs">
                {chips.map((chip) => (
                  <span
                    key={chip.title}
                    className={cn('rounded-md border px-2 py-0.5 font-medium', chip.bar)}
                    title={chip.title}
                  >
                    {chip.n} {chip.title}
                  </span>
                ))}
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Completion</span>
                  <span className="tabular-nums">{percent}%</span>
                </div>
                <div className="h-2 rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-primary transition-all"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
