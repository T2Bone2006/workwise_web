import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** One colour per kind of thing, used the same way across the overview (and as on Payments). */
export type Tone = 'sky' | 'emerald' | 'rose' | 'amber' | 'violet' | 'indigo' | 'teal';

/** Full class strings so Tailwind keeps them. */
export const TONE: Record<Tone, { chip: string; text: string; soft: string; border: string; bar: string }> = {
  sky: {
    chip: 'bg-sky-500/15 text-sky-600 dark:text-sky-300',
    text: 'text-sky-700 dark:text-sky-300',
    soft: 'bg-sky-500/10',
    border: 'border-sky-500/25',
    bar: 'bg-sky-500',
  },
  emerald: {
    chip: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
    text: 'text-emerald-700 dark:text-emerald-300',
    soft: 'bg-emerald-500/10',
    border: 'border-emerald-500/25',
    bar: 'bg-emerald-500',
  },
  rose: {
    chip: 'bg-rose-500/15 text-rose-600 dark:text-rose-300',
    text: 'text-rose-700 dark:text-rose-300',
    soft: 'bg-rose-500/10',
    border: 'border-rose-500/25',
    bar: 'bg-rose-500',
  },
  amber: {
    chip: 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
    text: 'text-amber-700 dark:text-amber-300',
    soft: 'bg-amber-500/10',
    border: 'border-amber-500/25',
    bar: 'bg-amber-500',
  },
  violet: {
    chip: 'bg-violet-500/15 text-violet-600 dark:text-violet-300',
    text: 'text-violet-700 dark:text-violet-300',
    soft: 'bg-violet-500/10',
    border: 'border-violet-500/25',
    bar: 'bg-violet-500',
  },
  indigo: {
    chip: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300',
    text: 'text-indigo-700 dark:text-indigo-300',
    soft: 'bg-indigo-500/10',
    border: 'border-indigo-500/25',
    bar: 'bg-indigo-500',
  },
  teal: {
    chip: 'bg-teal-500/15 text-teal-600 dark:text-teal-300',
    text: 'text-teal-700 dark:text-teal-300',
    soft: 'bg-teal-500/10',
    border: 'border-teal-500/25',
    bar: 'bg-teal-500',
  },
};

export function IconChip({ icon: Icon, tone, size = 'md' }: { icon: LucideIcon; tone: Tone; size?: 'sm' | 'md' }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full',
        size === 'sm' ? 'size-7' : 'size-9',
        TONE[tone].chip,
      )}
      aria-hidden="true"
    >
      <Icon className={size === 'sm' ? 'size-3.5' : 'size-[18px]'} />
    </span>
  );
}

/** A card with a coloured icon, a title, an optional one-line summary and a link out. */
export function SectionCard({
  icon,
  tone,
  title,
  summary,
  action,
  className,
  children,
  labelledBy,
}: {
  icon: LucideIcon;
  tone: Tone;
  title: string;
  summary?: ReactNode;
  action?: { href: string; label: string };
  className?: string;
  children: ReactNode;
  labelledBy: string;
}) {
  return (
    <Card className={cn('glass-card gap-4 p-4 sm:p-5', className)} aria-labelledby={labelledBy} role="region">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <IconChip icon={icon} tone={tone} />
          <div className="min-w-0">
            <h2 id={labelledBy} className="text-[15px] font-semibold leading-tight">
              {title}
            </h2>
            {summary ? <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">{summary}</p> : null}
          </div>
        </div>
        {action ? (
          <Link
            href={action.href}
            className="flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-1 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
          >
            {action.label}
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
      {children}
    </Card>
  );
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const shortDate = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** '2026-10-06' → 'Tue 6 Oct' */
export function formatShortDate(ymd: string): string {
  return shortDate.format(new Date(`${ymd.slice(0, 10)}T12:00:00Z`)).replace(',', '');
}

/** '2026-10-06' → '6 Oct' */
export function formatDayMonth(ymd: string): string {
  return dayMonth.format(new Date(`${ymd.slice(0, 10)}T12:00:00Z`));
}
