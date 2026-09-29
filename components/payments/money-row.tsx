import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type MoneyAccent = {
  glow: string;
  bar: string;
  wash: string;
};

export const MONEY_ACCENT = {
  received: {
    glow: 'rgb(16 185 129)',
    bar: 'bg-emerald-500',
    wash: 'from-emerald-500/[0.08] via-transparent to-transparent dark:from-emerald-400/15',
  },
  overdue: {
    glow: 'rgb(225 29 72)',
    bar: 'bg-rose-600',
    wash: 'from-rose-600/[0.08] via-transparent to-transparent dark:from-rose-400/15',
  },
  unpaid: {
    glow: 'rgb(245 158 11)',
    bar: 'bg-amber-500',
    wash: 'from-amber-500/[0.08] via-transparent to-transparent dark:from-amber-400/15',
  },
  quiet: {
    glow: 'rgb(100 116 139)',
    bar: 'bg-slate-500',
    wash: 'from-slate-500/[0.06] via-transparent to-transparent dark:from-slate-400/10',
  },
} as const satisfies Record<string, MoneyAccent>;

export function MoneyRow(props: {
  accent: MoneyAccent;
  icon: LucideIcon;
  title: string;
  detail?: string;
  amount?: string;
  status?: string;
  onClick?: () => void;
  actions?: ReactNode;
}): ReactNode {
  const Icon = props.icon;
  return (
    <li
      className="relative list-none overflow-hidden rounded-2xl border border-border/70 bg-[var(--glass-bg)] shadow-[var(--shadow-glass-value)] transition-all duration-200 sm:hover:-translate-y-0.5 dark:border-white/[0.06]"
    >
      <div className={cn('pointer-events-none absolute inset-y-0 left-0 w-1', props.accent.bar)} aria-hidden />
      <div
        className={cn('pointer-events-none absolute inset-0 bg-gradient-to-r', props.accent.wash)}
        aria-hidden
      />
      <div className="relative">
        <button
          type="button"
          onClick={props.onClick}
          className="flex w-full items-start gap-3 p-3 pl-4 text-left sm:p-4 sm:pl-5"
        >
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-full border"
            style={{
              borderColor: props.accent.glow.replace(')', ' / 0.45)'),
              backgroundColor: props.accent.glow.replace(')', ' / 0.12)'),
              color: props.accent.glow,
            }}
          >
            <Icon className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-medium tracking-tight">{props.title}</span>
            {props.detail ? (
              <span className="mt-1 block truncate text-sm text-foreground/80">{props.detail}</span>
            ) : null}
          </span>
          {props.amount || props.status ? (
            <span className="flex shrink-0 flex-col items-end gap-1 text-right">
              {props.amount ? (
                <span className="text-sm font-medium tabular-nums text-foreground">{props.amount}</span>
              ) : null}
              {props.status ? (
                <span className="text-xs font-medium text-foreground">{props.status}</span>
              ) : null}
            </span>
          ) : null}
        </button>
        {props.actions ? (
          <div className="flex flex-wrap items-center justify-end gap-2 px-4 pb-3 pl-16 sm:px-5 sm:pb-4">
            {props.actions}
          </div>
        ) : null}
      </div>
    </li>
  );
}
