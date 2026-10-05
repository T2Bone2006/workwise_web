'use client';

import { useState } from 'react';
import { CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isNextRedirect } from '@/components/settings/plan-billing/current-plan-card';
import { openCardUpdate } from '@/lib/actions/billing';

/** Not dismissible. Shown on every dashboard page while a live self-serve plan is past_due. */
export function OverdueBanner() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateCard = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await openCardUpdate();
      if (!result.ok) {
        setError(result.error);
        setPending(false);
      }
    } catch (err) {
      if (isNextRedirect(err)) return;
      setError('Could not open the card form. Please try again.');
      setPending(false);
    }
  };

  return (
    <div className="border-b border-(--tone-amber-line) bg-(--tone-amber-soft) px-4 py-3 sm:px-8">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-2 text-sm font-medium text-(--tone-amber-text)">
          <CreditCard className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>Your last payment didn&apos;t go through. Update your card to keep WorkWise running.</span>
        </p>
        <div className="flex shrink-0 flex-col items-start gap-1">
          <Button type="button" size="sm" disabled={pending} onClick={() => void updateCard()}>
            {pending ? 'Opening…' : 'Update card'}
          </Button>
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
