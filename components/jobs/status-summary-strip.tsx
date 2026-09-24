'use client';

import type { LucideIcon } from 'lucide-react';
import {
  Briefcase,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  PauseCircle,
  RadioTower,
  UserCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type SummaryStripItem = {
  key: string;
  title: string;
  icon: LucideIcon;
  glow: string;
  /** Displayed in the trailing pill — number or formatted string (e.g. £90). */
  count: number | string;
};

interface SummaryStripProps {
  items: SummaryStripItem[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  /** Label above the strip, e.g. "Overview" / "This day". */
  label?: string;
  /** Hint after the label. Pass empty string to hide. */
  hint?: string;
  className?: string;
  /** Grid column class — Pro uses 7 status pills; Rounds may use fewer. */
  gridClassName?: string;
}

/**
 * Clickable overview pills — shared chrome for Pro jobs status filters and
 * Rounds home metrics so the dashboards feel like one product.
 */
export function SummaryStrip({
  items,
  activeKey,
  onSelect,
  label = 'Overview',
  hint = '· click a status to filter',
  className,
  gridClassName = 'grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7',
}: SummaryStripProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border/70 bg-muted/25 px-2.5 py-2.5 sm:px-3.5 sm:py-3 dark:bg-muted/20',
        className
      )}
    >
      <div className="mb-2 px-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:mb-2.5">
        {label}
        {hint ? (
          <span className="ml-2 hidden font-normal normal-case tracking-normal text-muted-foreground/80 sm:inline">
            {hint}
          </span>
        ) : null}
      </div>
      <div className={cn('grid', gridClassName)}>
        {items.map((item) => {
          const Icon = item.icon;
          const active = activeKey === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onSelect(item.key)}
              aria-pressed={active}
              title={
                active ? `Clear ${item.title} filter` : `Filter to ${item.title}`
              }
              className={cn(
                'group relative inline-flex min-h-[2.5rem] items-center justify-between gap-1.5 rounded-full border px-2.5 py-2 text-left text-xs transition-all duration-200 sm:gap-2.5 sm:px-3.5 sm:text-sm',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                active
                  ? 'border-solid'
                  : 'border-border/60 bg-background/90 shadow-sm hover:-translate-y-0.5 hover:border-border hover:shadow-md dark:bg-background/70'
              )}
              style={
                active
                  ? {
                      borderColor: `color-mix(in srgb, ${item.glow} 55%, transparent)`,
                      background: `linear-gradient(145deg, color-mix(in srgb, ${item.glow} 26%, transparent), color-mix(in srgb, ${item.glow} 10%, transparent))`,
                      boxShadow: `0 8px 20px -12px color-mix(in srgb, ${item.glow} 70%, transparent), inset 0 1px 0 rgba(255,255,255,0.5)`,
                    }
                  : undefined
              }
            >
              <span className="relative inline-flex min-w-0 items-center gap-1.5 sm:gap-2">
                <span
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors sm:size-6',
                    active
                      ? 'border-white/50 bg-white/55 dark:border-white/15 dark:bg-white/10'
                      : 'border-transparent bg-transparent'
                  )}
                >
                  <Icon
                    className="size-3 shrink-0 sm:size-3.5"
                    style={{ color: item.glow }}
                    strokeWidth={active ? 2.4 : 2}
                  />
                </span>
                <span
                  className={cn(
                    'truncate',
                    active
                      ? 'font-semibold text-foreground'
                      : 'text-muted-foreground group-hover:text-foreground'
                  )}
                >
                  {item.title}
                </span>
              </span>
              <span
                className={cn(
                  'relative shrink-0 rounded-full border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums transition-colors sm:px-2 sm:text-xs',
                  active
                    ? 'border-white/45 bg-white/60 text-foreground dark:border-white/10 dark:bg-white/10'
                    : 'border-transparent text-foreground'
                )}
              >
                {item.count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export type StatusSummaryKey =
  | 'pending'
  | 'pending_send'
  | 'assigned'
  | 'in_progress'
  | 'paused'
  | 'completed'
  | 'incomplete';

export type StatusSummaryCounts = Record<StatusSummaryKey, number>;

const SUMMARY_ITEMS: Array<{
  key: StatusSummaryKey;
  title: string;
  icon: LucideIcon;
  glow: string;
}> = [
  {
    key: 'pending',
    title: 'Not Started',
    icon: CircleDashed,
    glow: 'rgb(100 116 139)',
  },
  {
    key: 'pending_send',
    title: 'Ready to send',
    icon: RadioTower,
    glow: 'rgb(6 182 212)',
  },
  {
    key: 'assigned',
    title: 'Assigned',
    icon: UserCheck,
    glow: 'rgb(245 158 11)',
  },
  {
    key: 'in_progress',
    title: 'In Progress',
    icon: Briefcase,
    glow: 'rgb(59 130 246)',
  },
  {
    key: 'paused',
    title: 'Paused',
    icon: PauseCircle,
    glow: 'rgb(180 83 9)',
  },
  {
    key: 'completed',
    title: 'Completed',
    icon: CheckCircle2,
    glow: 'rgb(16 185 129)',
  },
  {
    key: 'incomplete',
    title: 'Not completed',
    icon: CircleAlert,
    glow: 'rgb(249 115 22)',
  },
];

interface StatusSummaryStripProps {
  counts: StatusSummaryCounts;
  activeStatus: string | null;
  onSelect: (status: StatusSummaryKey) => void;
  /** Label above the strip, e.g. "Overview" / "This day". */
  label?: string;
  className?: string;
}

/**
 * Clickable status overview pills — shared by office jobs list, dashboard day
 * view, and the customer portal.
 */
export function StatusSummaryStrip({
  counts,
  activeStatus,
  onSelect,
  label = 'Overview',
  className,
}: StatusSummaryStripProps) {
  return (
    <SummaryStrip
      className={className}
      label={label}
      activeKey={activeStatus}
      onSelect={(key) => onSelect(key as StatusSummaryKey)}
      items={SUMMARY_ITEMS.map((item) => ({
        ...item,
        count: counts[item.key] ?? 0,
      }))}
    />
  );
}
