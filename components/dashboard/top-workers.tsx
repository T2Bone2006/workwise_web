import Link from 'next/link';
import type { TopWorkerItem } from '@/lib/data/dashboard';
import { cn } from '@/lib/utils';

const RANK_STYLES = [
  'text-amber-600 dark:text-amber-400',
  'text-slate-500 dark:text-slate-400',
  'text-amber-700 dark:text-amber-500',
  '',
  '',
];

export function TopWorkers({
  workers,
  emptyMessage = 'No completed jobs yet',
}: {
  workers: TopWorkerItem[];
  emptyMessage?: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4 dark:border-white/[0.06]">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Top workers (this month)</h3>
        <Link
          href="/workers"
          className="text-xs font-medium text-primary hover:underline"
        >
          View all
        </Link>
      </div>
      {workers.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <ul className="space-y-4">
          {workers.map((w, i) => (
            <li key={w.id}>
              <Link
                href={`/workers/${w.id}`}
                className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-muted/50"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {w.full_name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground truncate">{w.full_name}</span>
                    {i === 0 && (
                      <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                        Top
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {w.jobs_completed} jobs
                    </span>
                    {w.completion_rate != null && (
                      <span className="text-xs text-muted-foreground">
                        {w.completion_rate}% rate
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${w.progress}%` }}
                    />
                  </div>
                </div>
                <span className={cn('text-lg font-bold text-muted-foreground', RANK_STYLES[i])}>
                  {i + 1}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
