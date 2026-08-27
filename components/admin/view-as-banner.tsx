'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ViewAsBanner({ tenantName }: { tenantName: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const exit = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/view-as/stop', { method: 'POST' });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          redirectTo?: string;
        };
        if (!res.ok) {
          setError(data.error ?? 'Failed to exit view-as');
          return;
        }
        router.push(data.redirectTo ?? '/admin/view-as');
        router.refresh();
      } catch {
        setError('Failed to exit view-as');
      }
    });
  };

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/15 px-4 py-2.5 text-sm"
      role="status"
    >
      <p className="text-amber-950 dark:text-amber-50">
        Viewing as <span className="font-semibold">{tenantName}</span>
        <span className="text-amber-900/80 dark:text-amber-100/80">
          {' '}
          — acting as this client. Exit when you&apos;re done.
        </span>
        {error && (
          <span className="ml-2 text-destructive" role="alert">
            {error}
          </span>
        )}
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="border-amber-700/40 bg-background/80"
        disabled={isPending}
        onClick={exit}
      >
        <EyeOff className="size-4" />
        {isPending ? 'Exiting…' : 'Exit view-as'}
      </Button>
    </div>
  );
}
