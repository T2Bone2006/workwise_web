import Link from 'next/link';
import { Plus, Upload, UserPlus, ClipboardList } from 'lucide-react';
import { cn } from '@/lib/utils';

const actions = [
  { href: '/jobs/new', label: 'Create Job', icon: Plus, gradient: 'from-blue-500 to-blue-600', available: true },
  { href: '/import', label: 'Import Jobs', icon: Upload, gradient: 'from-violet-500 to-violet-600', available: true },
  { href: '/workers/new', label: 'Add Worker', icon: UserPlus, gradient: 'from-emerald-500 to-emerald-600', available: true },
  { href: '/jobs/review', label: 'Review queue', icon: ClipboardList, gradient: 'from-sky-500 to-sky-600', available: true },
] as const;

export function QuickActions() {
  return (
    <div className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4 dark:border-white/[0.06]">
      <h3 className="mb-4 text-sm font-semibold text-foreground">Quick actions</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {actions.map(({ href, label, icon: Icon, gradient, available }) => {
          const content = (
            <>
              <span className={cn('flex h-10 w-10 items-center justify-center rounded-lg bg-white/10', available && `bg-gradient-to-br ${gradient}`)}>
                <Icon className="size-5 text-white" />
              </span>
              <span className="font-medium">{label}</span>
            </>
          );
          if (available) {
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-3 rounded-xl border border-[var(--glass-border)] p-3',
                  'transition-all hover:-translate-y-0.5 hover:shadow-md',
                  `bg-gradient-to-br ${gradient} border-0 text-white hover:opacity-95`
                )}
              >
                {content}
              </Link>
            );
          }
          return (
            <span
              key={href}
              className="flex cursor-not-allowed items-center gap-3 rounded-xl border border-[var(--glass-border)] bg-muted/50 p-3 opacity-60"
            >
              {content}
            </span>
          );
        })}
      </div>
    </div>
  );
}
