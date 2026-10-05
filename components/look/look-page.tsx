import { cn } from '@/lib/utils';

/**
 * A page header for the new look: title, one line saying what the page is for,
 * and the page's actions on the right. Plain on the canvas, no gradient.
 */
export function LookPage({
  title,
  subtitle,
  actions,
  className,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-5', className)}>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        {actions ? <div className="w-full min-w-0 sm:w-auto sm:shrink-0">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}
