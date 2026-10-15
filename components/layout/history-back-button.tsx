'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageBreadcrumb } from '@/components/layout/page-breadcrumb';
import { cn } from '@/lib/utils';

/** Step back to the page that opened this one. A fresh visit uses the fallback. */
export function leaveViaHistory(
  router: { back: () => void; push: (href: string) => void },
  fallbackHref: string,
) {
  if (typeof window !== 'undefined' && window.history.length > 1) {
    router.back();
    return;
  }
  router.push(fallbackHref);
}

export function HistoryBackButton({
  fallbackHref,
  label = 'Back',
  iconOnly = false,
  className,
}: {
  fallbackHref: string;
  label?: string;
  /** Arrow only, for page titles that already name where you're going. */
  iconOnly?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const leave = () => leaveViaHistory(router, fallbackHref);

  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1', !iconOnly && '-ml-2')}>
      <Button
        type="button"
        variant="ghost"
        size={iconOnly ? 'icon' : 'sm'}
        aria-label={iconOnly ? label : undefined}
        className={cn(!iconOnly && 'w-fit', className)}
        onClick={leave}
      >
        <ArrowLeft className={cn('size-4', !iconOnly && 'mr-2')} />
        {iconOnly ? null : label}
      </Button>
      <PageBreadcrumb />
    </div>
  );
}
