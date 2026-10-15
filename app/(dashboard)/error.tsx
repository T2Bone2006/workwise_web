'use client';

import Link from 'next/link';
import { CircleAlert, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** A page failed to load. Say so plainly, offer the retry, and give support something to quote. */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-lg py-10">
      <div className="space-y-4 rounded-2xl border border-border bg-card p-6 text-center shadow-(--look-card-shadow) sm:p-8" role="alert">
        <span className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-(--tone-rose-soft) text-(--tone-rose-text)" aria-hidden="true">
          <CircleAlert className="size-5" />
        </span>
        <div className="space-y-1">
          <h1 className="text-lg font-semibold tracking-tight">Something went wrong loading this page</h1>
          <p className="text-sm text-muted-foreground">
            Nothing has been lost. Try again, and if it keeps happening tell us the reference below.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={reset} className="gap-2">
            <RefreshCw className="size-4" />
            Try again
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard">Back to the dashboard</Link>
          </Button>
        </div>
        {error.digest ? (
          <p className="text-xs text-muted-foreground">
            Reference <span className="font-mono">{error.digest}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
