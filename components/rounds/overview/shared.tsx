import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { IconChip as KitIconChip, toneClasses } from '@/components/look';
import { cn } from '@/lib/utils';

/** One colour per kind of thing, used the same way across the overview (and as on Payments). */
export type Tone = 'sky' | 'emerald' | 'rose' | 'amber' | 'violet' | 'indigo' | 'teal';

function toneSet(tone: Tone) {
  const c = toneClasses(tone);
  return { chip: c.chip, text: c.text, soft: c.soft, border: c.border, bar: c.solid };
}

/** The new look's tone colours (components/look/tones.ts), under the names this folder already uses. */
export const TONE: Record<Tone, { chip: string; text: string; soft: string; border: string; bar: string }> = {
  sky: toneSet('sky'),
  emerald: toneSet('emerald'),
  rose: toneSet('rose'),
  amber: toneSet('amber'),
  violet: toneSet('violet'),
  indigo: toneSet('indigo'),
  teal: toneSet('teal'),
};

export function IconChip({ icon, tone, size = 'md' }: { icon: LucideIcon; tone: Tone; size?: 'sm' | 'md' }) {
  return <KitIconChip icon={icon} tone={tone} size={size} />;
}

/** A card with a coloured icon, a title, an optional one-line summary and a link out. */
export function SectionCard({
  title,
  summary,
  aside,
  action,
  className,
  children,
  labelledBy,
}: {
  /** Kept so callers don't change; the drawing's cards have a title and no icon. */
  icon?: LucideIcon;
  tone?: Tone;
  title: string;
  summary?: ReactNode;
  /** Something small on the right, before the link (a count, a total). */
  aside?: ReactNode;
  action?: { href: string; label: string };
  className?: string;
  children: ReactNode;
  labelledBy: string;
}) {
  return (
    <section
      className={cn(
        'flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 text-card-foreground sm:p-5',
        className,
      )}
      aria-labelledby={labelledBy}
      role="region"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={labelledBy} className="text-[15px] leading-tight font-semibold">
            {title}
          </h2>
          {summary ? <p className="mt-1 text-xs text-muted-foreground sm:text-[13px]">{summary}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {aside}
          {action ? (
            <Link
              href={action.href}
              className="flex items-center gap-0.5 rounded-lg px-1.5 py-1 text-sm font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {action.label}
              <ChevronRight className="size-4" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      </div>
      {children}
    </section>
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
