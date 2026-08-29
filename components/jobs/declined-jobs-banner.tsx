import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getDeclinedJobs } from '@/lib/data/dashboard';
import { cn } from '@/lib/utils';

interface DeclinedJobsBannerProps {
  className?: string;
  /** 'red' for the jobs page, where these are actionable right now; 'amber' elsewhere. */
  variant?: 'amber' | 'red';
}

const VARIANT_CLASSES = {
  amber: {
    container: 'border-amber-400/40 bg-amber-500/10 dark:border-amber-400/30 dark:bg-amber-500/5',
    glow: 'shadow-[0_0_20px_-6px_rgba(245,158,11,0.25)]',
    iconWrap: 'bg-amber-500/20 dark:bg-amber-500/10',
    icon: 'text-amber-700 dark:text-amber-400',
    title: 'text-amber-900 dark:text-amber-100',
    body: 'text-amber-800/90 dark:text-amber-200/80',
    divider: 'border-amber-500/20',
    ref: 'text-amber-950 dark:text-amber-50',
    meta: 'text-amber-900/70 dark:text-amber-100/70',
    reason: 'text-amber-900/90 dark:text-amber-100/80',
    time: 'text-amber-800/70 dark:text-amber-200/60',
  },
  red: {
    container: 'border-red-400/40 bg-red-500/10 dark:border-red-400/30 dark:bg-red-500/5',
    glow: 'shadow-[0_0_20px_-6px_rgba(239,68,68,0.25)]',
    iconWrap: 'bg-red-500/20 dark:bg-red-500/10',
    icon: 'text-red-700 dark:text-red-400',
    title: 'text-red-900 dark:text-red-100',
    body: 'text-red-800/90 dark:text-red-200/80',
    divider: 'border-red-500/20',
    ref: 'text-red-950 dark:text-red-50',
    meta: 'text-red-900/70 dark:text-red-100/70',
    reason: 'text-red-900/90 dark:text-red-100/80',
    time: 'text-red-800/70 dark:text-red-200/60',
  },
} as const;

/**
 * Jobs waiting on a decision after a decline — status = 'declined' IS the
 * queue now (see getDeclinedJobs), so every job listed here genuinely needs
 * a dispatcher to reassign it, not just an FYI.
 */
export async function DeclinedJobsBanner({ className, variant = 'amber' }: DeclinedJobsBannerProps) {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return null;

  const declines = await getDeclinedJobs(tenantId);
  if (declines.length === 0) return null;

  const v = VARIANT_CLASSES[variant];

  return (
    <div className={cn('rounded-xl border px-4 py-3', v.container, v.glow, className)}>
      <div className="flex items-center gap-3">
        <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', v.iconWrap)}>
          <AlertTriangle className={cn('size-5', v.icon)} />
        </div>
        <div>
          <p className={cn('font-medium', v.title)}>
            {declines.length} declined job{declines.length === 1 ? '' : 's'} need{declines.length === 1 ? 's' : ''} reassigning
          </p>
          <p className={cn('text-sm', v.body)}>
            Open each job and auto-assign or pick a worker — the worker who declined it is excluded automatically.
          </p>
        </div>
      </div>
      <ul className={cn('mt-3 space-y-2 border-t pt-3', v.divider)}>
        {declines.map((d) => (
          <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
            <div className="min-w-0 flex-1">
              <Link href={`/jobs/${d.id}`} className={cn('font-medium hover:underline', v.ref)}>
                {d.reference_number ?? 'Job'}
              </Link>
              <span className={v.meta}>
                {' '}
                — {[d.address, d.postcode].filter(Boolean).join(', ') || 'no address'}
              </span>
              {d.decline_reason && (
                <p className={cn('mt-0.5 italic', v.reason)}>&ldquo;{d.decline_reason}&rdquo;</p>
              )}
            </div>
            <span className={cn('shrink-0 whitespace-nowrap text-xs', v.time)}>
              {formatDistanceToNow(new Date(d.updated_at), { addSuffix: true })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
