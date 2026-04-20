import Link from 'next/link';
import { Briefcase, CheckCircle2, CircleDashed, PauseCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DashboardJobStatCards } from '@/lib/data/dashboard';

const STAT_DEFS: {
  key: keyof DashboardJobStatCards;
  title: string;
  href: string;
  icon: typeof Briefcase;
  glow: string;
}[] = [
  {
    key: 'activeJobs',
    title: 'Active',
    href: '/jobs?status=in_progress',
    icon: Briefcase,
    glow: 'rgb(59 130 246)',
  },
  {
    key: 'completedToday',
    title: 'Completed Today',
    href: '/jobs?status=completed',
    icon: CheckCircle2,
    glow: 'rgb(16 185 129)',
  },
  {
    key: 'notStarted',
    title: 'Not Started',
    href: '/jobs?status=pending',
    icon: CircleDashed,
    glow: 'rgb(245 158 11)',
  },
  {
    key: 'paused',
    title: 'Paused',
    href: '/jobs?status=assigned',
    icon: PauseCircle,
    glow: 'rgb(139 92 246)',
  },
];

export function DashboardStatCards({ stats }: { stats: DashboardJobStatCards }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {STAT_DEFS.map(({ key, title, href, icon: Icon, glow }) => (
        <Link
          key={key}
          href={href}
          className={cn(
            'group relative overflow-hidden rounded-2xl border bg-[var(--glass-bg)] p-5',
            'border-[var(--glass-border)] shadow-[var(--shadow-glass-value)]',
            'transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-glow-sm-value)]',
            'dark:border-white/[0.06]'
          )}
          style={{
            boxShadow: `0 0 0 1px ${glow}20, var(--shadow-glass-value)`,
          }}
        >
          <div
            className="absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
            style={{ boxShadow: `inset 0 0 40px -10px ${glow}30` }}
            aria-hidden
          />
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-muted-foreground">{title}</p>
              <p className="mt-2 text-3xl font-bold tracking-tight text-foreground tabular-nums">
                {stats[key]}
              </p>
            </div>
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-foreground/80"
              style={{ backgroundColor: `${glow}20` }}
            >
              <Icon className="size-5" strokeWidth={2} />
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}
