'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { isNextRedirect } from '@/components/settings/plan-billing/current-plan-card';
import { planIsBackAction, startRestartAction } from '@/lib/actions/billing';
import { PLAN_KEYS, PLANS, priceLabel, type BillingInterval, type PlanChoice, type PlanKey } from '@/lib/billing/plans';
import { cn } from '@/lib/utils';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nonceFor(store: Record<string, string>, choice: PlanChoice): string {
  const key = `${choice.plan}:${choice.interval}`;
  const existing = store[key];
  if (existing) return existing;
  const next = crypto.randomUUID();
  store[key] = next;
  return next;
}

export function RestartPlanForm({ defaultChoice }: { defaultChoice: PlanChoice }) {
  const [choice, setChoice] = useState<PlanChoice>(defaultChoice);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const nonces = useRef<Record<string, string>>({});

  const pickPlan = (plan: PlanKey) => setChoice((current) => ({ ...current, plan }));
  const pickInterval = (interval: BillingInterval) => setChoice((current) => ({ ...current, interval }));

  const restart = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await startRestartAction(choice, nonceFor(nonces.current, choice));
      if (!result.ok) {
        setError(result.error);
        busy.current = false;
        setPending(false);
      }
    } catch (err) {
      if (isNextRedirect(err)) return;
      setError("Couldn't restart your plan. Nothing was charged. Please try again.");
      busy.current = false;
      setPending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div role="group" aria-label="How often you pay" className="flex gap-1 rounded-full bg-look-segment p-1">
        {(['month', 'year'] as const).map((interval) => {
          const on = choice.interval === interval;
          return (
            <button
              key={interval}
              type="button"
              aria-pressed={on}
              disabled={pending}
              onClick={() => pickInterval(interval)}
              className={cn(
                'h-9 flex-1 rounded-full text-sm font-semibold transition-colors',
                on ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {interval === 'month' ? 'Monthly' : 'Yearly'}
            </button>
          );
        })}
      </div>

      <div role="group" aria-label="Plan" className="grid gap-2">
        {PLAN_KEYS.map((plan) => {
          const on = choice.plan === plan;
          return (
            <button
              key={plan}
              type="button"
              aria-pressed={on}
              disabled={pending}
              onClick={() => pickPlan(plan)}
              className={cn(
                'flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left',
                on ? 'border-primary bg-card ring-2 ring-primary/30' : 'border-border bg-card hover:bg-muted/40',
              )}
            >
              <span className="text-sm font-semibold">{PLANS[plan].label}</span>
              <span className="text-sm text-muted-foreground">{priceLabel({ plan, interval: choice.interval })}</span>
            </button>
          );
        })}
      </div>

      <Button type="button" className="w-full" disabled={pending} onClick={() => void restart()}>
        {pending ? 'Opening checkout…' : `Restart for ${priceLabel(choice)}`}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function PlanEnded({ defaultChoice }: { defaultChoice: PlanChoice }) {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-5">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Your plan has ended</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Your customers, history and settings are all saved. Restart whenever you&apos;re ready and everything picks up
          where you left off.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          While it&apos;s off: no reminders or texts go out, no Direct Debits are collected, and your website assistant is
          paused.
        </p>
      </div>
      <RestartPlanForm defaultChoice={defaultChoice} />
      <p className="text-sm">
        <Link href="/settings?tab=danger" className="text-muted-foreground underline underline-offset-2">
          Close my account instead
        </Link>
      </p>
    </div>
  );
}

/** ?restarted=1: toast once the webhook has synced an entitled plan. Gives up after 20s. */
export function RestartedWelcome() {
  const params = useSearchParams();
  const router = useRouter();
  const started = useRef(false);

  useEffect(() => {
    if (params.get('restarted') !== '1' || started.current) return;
    started.current = true;
    let cancelled = false;
    const run = async () => {
      const deadline = Date.now() + 20_000;
      while (!cancelled) {
        if (await planIsBackAction()) {
          toast('Welcome back. Your plan is on again.');
          router.refresh();
          return;
        }
        if (Date.now() >= deadline) return;
        await sleep(1500);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [params, router]);

  return null;
}
