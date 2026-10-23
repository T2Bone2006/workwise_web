import Link from 'next/link';
import { Smartphone } from 'lucide-react';
import { IconChip } from '@/components/look';
import { APP_DOWNLOAD_PATH } from '@/lib/app-stores';
import { cn } from '@/lib/utils';

/**
 * Points the worker at the app for the things the website does not do (start, pause, finish, photos, the report).
 * `bar` is a banner for the one place a worker needs it (an accepted job); `line` is a quiet footer line.
 */
export function PhoneNote({
  children,
  variant = 'bar',
  className,
}: {
  children: React.ReactNode;
  variant?: 'bar' | 'line';
  className?: string;
}) {
  const link = (
    <Link
      href={APP_DOWNLOAD_PATH}
      className="shrink-0 text-sm font-medium text-(--tone-sky-text) underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      Get the app
    </Link>
  );

  if (variant === 'line') {
    return (
      <p className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground', className)}>
        <Smartphone className="size-4 shrink-0" aria-hidden />
        <span>{children}</span>
        {link}
      </p>
    );
  }

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border border-(--tone-sky-line) bg-(--tone-sky-soft) px-3.5 py-3 text-sm',
        className,
      )}
    >
      <IconChip icon={Smartphone} tone="sky" size="sm" />
      <p className="min-w-0 flex-1 text-foreground">{children}</p>
      {link}
    </div>
  );
}
