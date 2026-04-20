'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { AlertCircle, RefreshCw } from 'lucide-react';

export default function JobsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[JobsError] Boundary caught:', error?.message ?? error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
      <div className="rounded-full border border-destructive/30 bg-destructive/10 p-4">
        <AlertCircle className="size-8 text-destructive" aria-hidden />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-foreground">
        Unable to load jobs
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Something went wrong. Please try again or contact support.
      </p>
      <div className="mt-6 flex gap-3">
        <Button variant="outline" onClick={reset} className="gap-2">
          <RefreshCw className="size-4" />
          Try again
        </Button>
        <Button variant="default" asChild>
          <Link href="/dashboard">Back to Dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
