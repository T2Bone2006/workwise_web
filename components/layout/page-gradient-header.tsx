import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageGradientHeaderProps {
  title: string;
  subtitle?: string;
  /** Small uppercase line above the title (e.g. tenant name). */
  eyebrow?: string;
  /** Right-side controls (day nav, actions). */
  actions?: ReactNode;
  className?: string;
}

/**
 * Soft sky→cyan page header. Readable in light mode, quieter in dark.
 */
export function PageGradientHeader({
  title,
  subtitle,
  eyebrow,
  actions,
  className,
}: PageGradientHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-5',
        // Light: stronger sky wash so it doesn’t disappear on white.
        'border-sky-300/80 bg-gradient-to-br from-sky-200/90 via-sky-100 to-cyan-100',
        'shadow-[0_1px_0_rgba(14,165,233,0.18),0_10px_28px_-12px_rgba(14,165,233,0.4)]',
        // Dark: same direction, deeper tones (already worked well).
        'dark:border-sky-800/45 dark:from-sky-950/55 dark:via-background dark:to-cyan-950/25',
        'dark:shadow-none',
        className
      )}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-xs font-medium uppercase tracking-wide text-sky-800 dark:text-sky-300/85">
            {eyebrow}
          </p>
        ) : null}
        <h1
          className={cn(
            'text-2xl font-bold tracking-tight text-slate-900 dark:text-foreground',
            eyebrow && 'mt-1'
          )}
        >
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-sky-900/65 dark:text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}
