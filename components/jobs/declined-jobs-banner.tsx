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
    container:
      'border-border/70 bg-gradient-to-br from-amber-100/95 via-amber-50/85 to-yellow-100/80 shadow-[0_1px_0_rgba(245,158,11,0.12),0_10px_28px_-14px_rgba(245,158,11,0.28)] dark:border-white/[0.08] dark:from-amber-950/50 dark:via-background dark:to-yellow-950/25 dark:shadow-none',
    iconWrap: 'border border-border/60 bg-amber-500/15 backdrop-blur-sm dark:border-white/10 dark:bg-amber-500/10',
    icon: 'text-amber-800 dark:text-amber-300',
    title: 'text-amber-950 dark:text-amber-100',
    body: 'text-amber-900/80 dark:text-amber-200/75',
    divider: 'border-border/60 dark:border-white/[0.08]',
    ref: 'text-amber-950 dark:text-amber-50',
    meta: 'text-amber-900/70 dark:text-amber-100/70',
    reason: 'text-amber-900/85 dark:text-amber-100/80',
    time: 'text-amber-800/70 dark:text-amber-200/60',
  },
  red: {
    container:
      'border-border/70 bg-gradient-to-br from-red-100/95 via-rose-50/85 to-red-100/80 shadow-[0_1px_0_rgba(239,68,68,0.1),0_10px_28px_-14px_rgba(239,68,68,0.26)] dark:border-white/[0.08] dark:from-red-950/50 dark:via-background dark:to-rose-950/25 dark:shadow-none',
    iconWrap: 'border border-border/60 bg-red-500/15 backdrop-blur-sm dark:border-white/10 dark:bg-red-500/10',
    icon: 'text-red-800 dark:text-red-300',
    title: 'text-red-950 dark:text-red-100',
    body: 'text-red-900/80 dark:text-red-200/75',
    divider: 'border-border/60 dark:border-white/[0.08]',
    ref: 'text-red-950 dark:text-red-50',
    meta: 'text-red-900/70 dark:text-red-100/70',
    reason: 'text-red-900/85 dark:text-red-100/80',
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
    <div
      className={cn(
        'rounded-2xl border px-4 py-3 backdrop-blur-sm',
        v.container,
        className
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', v.iconWrap)}>
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
