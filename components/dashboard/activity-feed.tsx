import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import type { ActivityFeedItem } from '@/lib/data/dashboard';
import { Briefcase, UserPlus, CheckCircle, XCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

function eventIcon(toStatus: string) {
  switch (toStatus) {
    case 'pending':
      return Clock;
    case 'assigned':
      return UserPlus;
    case 'completed':
      return CheckCircle;
    case 'cancelled':
      return XCircle;
    default:
      return Briefcase;
  }
}

function eventColor(toStatus: string) {
  switch (toStatus) {
    case 'pending':
      return 'text-amber-500';
    case 'assigned':
      return 'text-violet-500';
    case 'completed':
      return 'text-emerald-500';
    case 'cancelled':
      return 'text-red-500';
    default:
      return 'text-blue-500';
  }
}

function eventLabel(item: ActivityFeedItem): string {
  const ref = item.reference_number ?? `#${item.job_id?.slice(0, 8) ?? '?'}`;
  switch (item.to_status) {
    case 'pending':
      return `Job ${ref} created`;
    case 'assigned':
      return item.worker_name
        ? `Job ${ref} assigned to ${item.worker_name}`
        : `Job ${ref} assigned`;
    case 'in_progress':
      return `Job ${ref} started`;
    case 'completed':
      return `Job ${ref} completed`;
    case 'cancelled':
      return `Job ${ref} cancelled`;
    default:
      return `Job ${ref} → ${item.to_status}`;
  }
}

export function ActivityFeed({ items }: { items: ActivityFeedItem[] }) {
  return (
    <div className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4 dark:border-white/[0.06]">
      <h3 className="mb-4 text-sm font-semibold text-foreground">Activity</h3>
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No recent activity</p>
      ) : (
        <ul className="space-y-0">
          {items.map((item, i) => {
            const Icon = eventIcon(item.to_status);
            const isLast = i === items.length - 1;
            return (
              <li key={item.id} className="relative flex gap-3 pb-4">
                {!isLast && (
                  <span
                    className="absolute left-[11px] top-6 bottom-0 w-px bg-border"
                    aria-hidden
                  />
                )}
                <span
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted',
                    eventColor(item.to_status)
                  )}
                >
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  {item.job_id ? (
                    <Link
                      href={`/jobs/${item.job_id}`}
                      className="text-sm text-foreground hover:underline"
                    >
                      {eventLabel(item)}
                    </Link>
                  ) : (
                    <span className="text-sm text-foreground">{eventLabel(item)}</span>
                  )}
                  <p
                    className="mt-0.5 text-xs text-muted-foreground"
                    title={new Date(item.created_at).toLocaleString()}
                  >
                    {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
