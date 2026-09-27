'use client';

import { useState, type FormEvent } from 'react';
import { startCardPaymentsSetup } from '@/lib/actions/stripe-connect';
import { Button } from '@/components/ui/button';

export function ContinueSetupButton() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await startCardPaymentsSetup();
    if (!result.success) {
      setError(result.error);
      setPending(false);
      return;
    }
    window.location.assign(result.url);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Opening Stripe…' : 'Continue setup'}
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </form>
  );
}
