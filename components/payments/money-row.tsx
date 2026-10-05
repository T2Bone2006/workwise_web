import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Avatar, IconChip, Tag, toneClasses, type Tone } from '@/components/look';
import { cn } from '@/lib/utils';

/** What a money row means: the colour of its icon, its amount and its status tag. */
export type MoneyAccent = { tone: Tone };

export const MONEY_ACCENT = {
  received: { tone: 'emerald' },
  overdue: { tone: 'rose' },
  unpaid: { tone: 'rounds' },
  quiet: { tone: 'slate' },
} as const satisfies Record<string, MoneyAccent>;

/**
 * One row in Who owes / Came in / Invoices: a white card with who and what
 * on the left, the amount (coloured by meaning) and a status tag on the right.
 * Payments is a Rounds page, so this only ever renders in the new look.
 */
export function MoneyRow(props: {
  accent: MoneyAccent;
  icon: LucideIcon;
  title: string;
  detail?: string;
  amount?: string;
  status?: string;
  /** Tone of the status tag; defaults to the row's own tone. */
  statusTone?: Tone;
  /** Show the customer's initials instead of the icon. */
  avatar?: boolean;
  /** Small chips shown under the detail line. */
  tags?: ReactNode;
  onClick?: () => void;
  actions?: ReactNode;
}): ReactNode {
  const tone = props.accent.tone;
  return (
    <li
      className={cn(
        'relative list-none rounded-2xl border border-border bg-card shadow-(--look-card-shadow) transition-colors',
        props.onClick && 'hover:border-(--tone-slate-solid)/40',
      )}
    >
      <div className="relative flex flex-wrap items-center gap-x-3 gap-y-2.5 p-3 sm:flex-nowrap sm:gap-4 sm:p-3.5">
        {props.onClick ? (
          <button
            type="button"
            onClick={props.onClick}
            aria-label={props.title}
            className="absolute inset-0 rounded-2xl focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          />
        ) : null}
        <span className="pointer-events-none flex min-w-0 flex-1 basis-48 items-center gap-3 text-left">
          {props.avatar ? (
            <Avatar name={props.title} tone={tone} />
          ) : (
            <IconChip icon={props.icon} tone={tone} />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-medium tracking-tight">{props.title}</span>
            {props.detail ? (
              <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">{props.detail}</span>
            ) : null}
            {props.tags ? <span className="mt-1.5 flex flex-wrap gap-1.5">{props.tags}</span> : null}
          </span>
        </span>
        {props.actions ? (
          <div className="relative z-10 flex shrink-0 flex-wrap items-center gap-2">{props.actions}</div>
        ) : null}
        {props.amount || props.status ? (
          <span className="pointer-events-none ml-auto flex min-w-20 shrink-0 flex-col items-end gap-1 text-right">
            {props.amount ? (
              <span className={cn('text-base font-semibold tabular-nums', toneClasses(tone).text)}>
                {props.amount}
              </span>
            ) : null}
            {props.status ? <Tag tone={props.statusTone ?? tone}>{props.status}</Tag> : null}
          </span>
        ) : null}
      </div>
    </li>
  );
}
