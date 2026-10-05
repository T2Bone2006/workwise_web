'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { authButtonClassName, authSecondaryButtonClassName } from '@/components/auth/auth-shell';
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
      <div className="space-y-3">
        <a href="/api/stripe/checkout" className={authButtonClassName}>
          Resume payment
        </a>
        <p className="text-center text-[13px] leading-relaxed text-[#6E6A63] dark:text-[#93A3BA]">
          Your login has been created; only the card step is outstanding.
        </p>
      </div>
    );
  }

  const done = status === 'provisioned';

  return (
    <div className="space-y-6">
      <div
        role="status"
        className="rounded-2xl border border-[#EBEBEA] bg-[#FAFAF8] p-4 dark:border-white/10 dark:bg-white/[0.03]"
      >
        <div className="flex items-center gap-2.5 text-sm font-medium text-[#0A1A2E] dark:text-[#EAF1FB]">
          <Loader2 className="size-4 animate-spin text-[#0C66E4] dark:text-[#7FAAF0]" aria-hidden />
          {done ? 'Done. Taking you in…' : 'Confirming your subscription…'}
        </div>
        <div aria-hidden className="mt-3.5 h-1.5 overflow-hidden rounded-full bg-[#E7EEF9] dark:bg-white/10">
          <div
            className={
              done
                ? 'h-full w-full rounded-full bg-[#0C66E4] transition-all duration-500'
                : 'h-full w-1/3 animate-[signup-progress_1.4s_ease-in-out_infinite] rounded-full bg-[#0C66E4] motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-60'
            }
          />
        </div>
      </div>
      <style>{`@keyframes signup-progress { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }`}</style>
      {slow && (
        <div className="space-y-3">
          <p className="text-center text-[13px] leading-relaxed text-[#6E6A63] dark:text-[#93A3BA]">
            Taking longer than usual? If you didn&apos;t finish the payment step, you can resume it.
          </p>
          <a href="/api/stripe/checkout" className={authSecondaryButtonClassName}>
            Resume payment
          </a>
        </div>
      )}
    </div>
  );
}
