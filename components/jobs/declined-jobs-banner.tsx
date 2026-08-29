import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getRecentlyDeclinedJobs } from '@/lib/data/dashboard';
import { cn } from '@/lib/utils';

interface DeclinedJobsBannerProps {
  className?: string;
}

/**
 * Recent decline activity — not a queue of stuck jobs. handle_job_declined()
 * already returns a declined job to `pending` (or reassigns it) immediately,
 * so nothing here needs manual action; this is purely "here's what happened
 * and why", surfaced so a pattern (same address, same reason) is visible
 * without opening each job individually.
 */
export async function DeclinedJobsBanner({ className }: DeclinedJobsBannerProps) {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return null;

  const declines = await getRecentlyDeclinedJobs(tenantId, 7);
  if (declines.length === 0) return null;

  return (
    <div
      className={cn(
        'rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 shadow-[0_0_20px_-6px_rgba(245,158,11,0.25)]',
        'dark:border-amber-400/30 dark:bg-amber-500/5',
        className
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 dark:bg-amber-500/10">
          <AlertTriangle className="size-5 text-amber-700 dark:text-amber-400" />
        </div>
        <div>
          <p className="font-medium text-amber-900 dark:text-amber-100">
            {declines.length} job{declines.length === 1 ? '' : 's'} declined in the last 7 days
          </p>
          <p className="text-sm text-amber-800/90 dark:text-amber-200/80">
            Already back in the queue — nothing to action, but worth a glance for a pattern.
          </p>
        </div>
      </div>
      <ul className="mt-3 space-y-2 border-t border-amber-500/20 pt-3">
        {declines.map((d) => (
          <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
            <div className="min-w-0 flex-1">
              {d.job_id ? (
                <Link
                  href={`/jobs/${d.job_id}`}
                  className="font-medium text-amber-950 hover:underline dark:text-amber-50"
                >
                  {d.reference_number ?? 'Job'}
                </Link>
              ) : (
                <span className="font-medium text-amber-950 dark:text-amber-50">
                  {d.reference_number ?? 'Job'}
                </span>
              )}
              <span className="text-amber-900/70 dark:text-amber-100/70">
                {' '}
                — {[d.address, d.postcode].filter(Boolean).join(', ') || 'no address'}
                {d.worker_name ? ` · declined by ${d.worker_name}` : ''}
              </span>
              {d.reason && (
                <p className="mt-0.5 text-amber-900/90 italic dark:text-amber-100/80">
                  &ldquo;{d.reason}&rdquo;
                </p>
              )}
            </div>
            <span className="shrink-0 whitespace-nowrap text-xs text-amber-800/70 dark:text-amber-200/60">
              {formatDistanceToNow(new Date(d.created_at), { addSuffix: true })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
