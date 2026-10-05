import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { LookAttribute } from './look-attribute';

/**
 * The page behind everything a business's customers (or their accountant) open from a link:
 * pay pages, the one-tap lead page, the accountant's pages, the return pages. They sit outside
 * the dashboard, so this puts the new look on them (and on their dialogs) and gives them the warm canvas.
 */
export function PublicFrame({
  children,
  className,
  width = 'max-w-[480px]',
}: {
  children: ReactNode;
  className?: string;
  /** A Tailwind max-width class for the content column. */
  width?: string;
}) {
  return (
    <div data-look="new" className={cn('min-h-screen bg-background text-foreground', className)}>
      <LookAttribute look="new" />
      <div className={cn('mx-auto flex w-full flex-col px-4 py-8 sm:py-12', width)}>{children}</div>
    </div>
  );
}

/** The business's logo, or its initials when it has none: the first thing a customer should see. */
export function BusinessMark({ name, logoUrl, size = 'md' }: { name: string; logoUrl: string | null; size?: 'md' | 'lg' }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('');
  const box = size === 'lg' ? 'size-12 rounded-xl text-sm' : 'size-10 rounded-xl text-xs';
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logoUrl} alt="" className={cn(box, 'shrink-0 border border-border bg-card object-contain p-0.5')} />
    );
  }
  return (
    <span
      className={cn(box, 'flex shrink-0 items-center justify-center bg-(--tone-rounds-solid) font-bold text-white')}
      aria-hidden="true"
    >
      {initials || 'W'}
    </span>
  );
}
