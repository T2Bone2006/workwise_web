import Link from 'next/link';
import { cn } from '@/lib/utils';

export type PageTabItem<K extends string> = {
  key: K;
  label: string;
  href: string;
  /** A small number beside the label, e.g. how many are waiting. */
  count?: number;
  /** Colour the number when it means something needs you. */
  countTone?: 'rose' | 'amber';
};

/**
 * The tab row under a page header: plain links with an underline on the current one.
 * Each tab is its own address, so Back, refresh and sharing a link all work.
 */
export function PageTabs<K extends string>({
  items,
  active,
  ariaLabel,
}: {
  items: PageTabItem<K>[];
  active: K;
  ariaLabel: string;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className="-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
    >
      {items.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              '-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
              isActive ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
            {tab.count ? (
              <span
                className={cn(
                  'rounded-full px-1.5 text-xs tabular-nums',
                  tab.countTone === 'rose'
                    ? 'bg-(--tone-rose-soft) text-(--tone-rose-text)'
                    : tab.countTone === 'amber'
                      ? 'bg-(--tone-amber-soft) text-(--tone-amber-text)'
                      : 'bg-muted text-muted-foreground',
                )}
              >
                {tab.count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
