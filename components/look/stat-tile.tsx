import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconChip } from './icon-chip';
import { toneClasses, type Tone } from './tones';

/**
 * A big figure with a label and a sub-line, coloured by what it means.
 * From the tiles in OverviewDesktop / PaymentsRendering on the site.
 * `sub` can be text or a node (e.g. a progress bar).
 */
export function StatTile({
  label,
  value,
  sub,
  tone = 'slate',
  icon,
  href,
  footer,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  tone?: Tone;
  icon?: LucideIcon;
  href?: string;
  /** Pinned to the bottom of the tile, e.g. a small chart. */
  footer?: React.ReactNode;
}) {
  const body = (
    <div
      className={cn(
        'flex h-full flex-col rounded-2xl border border-border bg-card p-3.5 shadow-(--look-card-shadow) sm:p-4',
        href && 'transition-colors group-hover:border-(--tone-slate-solid)/40',
      )}
    >
      <p className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
        {icon ? <IconChip icon={icon} tone={tone} size="sm" /> : null}
        <span className="truncate">{label}</span>
      </p>
      <p className={cn('mt-2.5 text-2xl font-semibold tracking-tight tabular-nums sm:text-[28px]', toneClasses(tone).figure)}>{value}</p>
      {sub ? <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{sub}</div> : null}
      {footer ? <div className="mt-auto pt-3">{footer}</div> : null}
    </div>
  );
  if (!href) return body;
  return (
    <Link href={href} className="group block rounded-2xl focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
      {body}
    </Link>
  );
}
