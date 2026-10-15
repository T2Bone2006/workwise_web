'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isNextRedirect } from '@/components/settings/plan-billing/current-plan-card';
import { startProRestartAction } from '@/lib/actions/billing';
import type { BillingInterval } from '@/lib/billing/plans';
import { proRestartSummary } from '@/lib/billing/pro-restart-core';
import { PRO_PLANS, PRO_TIER_ORDER, formatPoundsLong, proCost, type ProChoice, type ProTier } from '@/lib/billing/pro-plans';
import { cn } from '@/lib/utils';

function nonceFor(store: Record<string, string>, choice: ProChoice): string {
  const key = `${choice.tier}:${choice.interval}`;
  const existing = store[key];
  if (existing) return existing;
  const next = crypto.randomUUID();
  store[key] = next;
  return next;
}

/** Restart page for a self-serve Pro business whose plan has ended: the tiers at the price for the team they have today. */
export function ProPlanEnded({ defaultChoice, teamSize }: { defaultChoice: ProChoice; teamSize: number }) {
  const [choice, setChoice] = useState<ProChoice>(defaultChoice);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const nonces = useRef<Record<string, string>>({});

  const pickTier = (tier: ProTier) => setChoice((current) => ({ ...current, tier }));
  const pickInterval = (interval: BillingInterval) => setChoice((current) => ({ ...current, interval }));
  const per = choice.interval === 'month' ? 'a month' : 'a year';
  const summary = proRestartSummary(choice, teamSize);

  const restart = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await startProRestartAction(choice, nonceFor(nonces.current, choice));
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
    <div className="mx-auto flex w-full max-w-lg flex-col gap-5">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Your plan has ended.</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Restart your plan to get your team back to work. Your workers, customers and jobs are all still here.
        </p>
      </div>

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
          {PRO_TIER_ORDER.map((tier) => {
            const on = choice.tier === tier;
            const cost = proCost({ tier, interval: choice.interval }, teamSize);
            return (
              <button
                key={tier}
                type="button"
                aria-pressed={on}
                disabled={pending}
                onClick={() => pickTier(tier)}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left',
                  on ? 'border-primary bg-card ring-2 ring-primary/30' : 'border-border bg-card hover:bg-muted/40',
                )}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{PRO_PLANS[tier].name}</span>
                  <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <Users className="size-3.5" aria-hidden />
                    {PRO_PLANS[tier].included} workers included
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-semibold tabular-nums">{formatPoundsLong(cost.totalPence)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {per}{teamSize > 0 ? ` for ${teamSize} ${teamSize === 1 ? 'worker' : 'workers'}` : ''}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {summary ? <p className="rounded-xl bg-muted/50 px-4 py-3 text-sm">{summary}</p> : null}

        <Button type="button" className="w-full" disabled={pending} onClick={() => void restart()}>
          {pending ? 'Opening checkout…' : 'Restart plan'}
        </Button>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      <p className="text-sm">
        <Link href="/settings?tab=danger" className="text-muted-foreground underline underline-offset-2">
          Close my account instead
        </Link>
      </p>
    </div>
  );
}
