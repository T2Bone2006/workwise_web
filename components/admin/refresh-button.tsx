'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Reloads this page's numbers in place (no full browser reload), and says when they were last loaded. */
export function RefreshButton({ updatedAt }: { updatedAt: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex shrink-0 items-center gap-3">
      <span className="hidden text-xs text-muted-foreground sm:inline" aria-live="polite">
        {pending ? 'Updating…' : `Updated ${updatedAt}`}
      </span>
      <button
        type="button"
        onClick={() => startTransition(() => router.refresh())}
        disabled={pending}
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
      >
        <RefreshCw className={cn('size-4', pending && 'animate-spin')} aria-hidden />
        Refresh
      </button>
    </div>
  );
}
