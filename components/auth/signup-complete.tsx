'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SignupStatus } from '@/app/api/signup/status/route';

const POLL_MS = 2000;
const SLOW_AFTER_MS = 60_000;

/**
 * Waits for the Stripe webhook to provision the account, then sends the user
 * to the dashboard. After a minute offers a "resume payment" escape hatch in
 * case Checkout never completed.
 */
export function SignupComplete({ canceled }: { canceled: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<SignupStatus | 'checking'>('checking');
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (canceled) return;
    let cancelled = false;
    const startedAt = Date.now();

    const tick = async () => {
      try {
        const res = await fetch('/api/signup/status', { cache: 'no-store' });
        const body = (await res.json()) as { status: SignupStatus };
        if (cancelled) return;
        setStatus(body.status);
        if (body.status === 'provisioned') {
          router.replace('/dashboard');
          return;
        }
        if (body.status === 'unauthenticated') {
          router.replace('/login');
          return;
        }
      } catch {
        // transient; keep polling
      }
      if (Date.now() - startedAt > SLOW_AFTER_MS) setSlow(true);
      if (!cancelled) setTimeout(tick, POLL_MS);
    };

    tick();
    return () => {
      cancelled = true;
    };
  }, [canceled, router]);

  if (canceled) {
    return (
      <div className="space-y-3 text-center">
        <Button asChild variant="gradient" className="w-full">
          <a href="/api/stripe/checkout">Resume payment</a>
        </Button>
        <p className="text-xs text-muted-foreground">Your login has been created; only the card step is outstanding.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-center">
      <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {status === 'provisioned' ? 'Done. Taking you in…' : 'Confirming your subscription…'}
      </div>
      {slow && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Taking longer than usual? If you didn&apos;t finish the payment step, you can resume it.
          </p>
          <Button asChild variant="outline" className="w-full">
            <a href="/api/stripe/checkout">Resume payment</a>
          </Button>
        </div>
      )}
    </div>
  );
}
