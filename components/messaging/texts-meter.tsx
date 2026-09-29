'use client';

import { useState, type JSX } from 'react';
import { toast } from 'sonner';
import { startTextPackCheckout } from '@/lib/actions/text-packs';
import type { TextUsage } from '@/lib/data/messaging/texts';
import { cn } from '@/lib/utils';

function priceLabel(pricePence: number): string {
  const pounds = pricePence / 100;
  return Number.isInteger(pounds) ? `£${pounds}` : `£${pounds.toFixed(2)}`;
}

export function TextsMeter(props: { usage: TextUsage }): JSX.Element {
  const { usage } = props;
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const out = usage.totalLeft === 0;
  const low = usage.totalLeft <= 20;
  const pct =
    usage.allowance > 0
      ? Math.min(100, Math.round((usage.freeUsed / usage.allowance) * 100))
      : 0;

  async function buy(key: string) {
    setBusyKey(key);
    const result = await startTextPackCheckout(key);
    if ('url' in result && result.url) {
      window.location.assign(result.url);
      return;
    }
    setBusyKey(null);
    toast.error('error' in result ? result.error : 'Could not start checkout');
  }

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <section
        className={cn(
          'rounded-2xl border p-5 shadow-sm lg:col-span-3',
          out
            ? 'border-amber-300/80 bg-gradient-to-br from-amber-50 via-white to-orange-50 dark:border-amber-400/30 dark:from-amber-500/15 dark:via-background dark:to-orange-500/10'
            : 'border-sky-200/80 bg-gradient-to-br from-sky-100/90 via-white to-cyan-50 dark:border-sky-400/25 dark:from-sky-500/15 dark:via-background dark:to-cyan-500/10',
        )}
      >
        <p
          className={cn(
            'text-xs font-semibold uppercase tracking-wide',
            out ? 'text-amber-800 dark:text-amber-200' : 'text-sky-800 dark:text-sky-200',
          )}
        >
          Texts this month
        </p>
        <p className="mt-2 flex items-baseline gap-2">
          <span className="text-4xl font-semibold tabular-nums tracking-tight">{usage.totalLeft}</span>
          <span className="text-sm text-muted-foreground">left</span>
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {usage.freeUsed} of {usage.allowance} free used · {usage.packLeft} bought left
        </p>
        <div
          className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-white/80 dark:bg-white/10"
          role="progressbar"
          aria-valuenow={usage.freeUsed}
          aria-valuemin={0}
          aria-valuemax={usage.allowance}
          aria-label="Free texts used this month"
        >
          <div
            className={cn('h-full rounded-full', low ? 'bg-amber-500' : 'bg-sky-500')}
            style={{ width: `${pct}%` }}
          />
        </div>
        {out ? (
          <p className="mt-3 text-sm font-medium text-amber-800 dark:text-amber-200">
            You&apos;re out of texts. Reminders are paused; other messages go by email.
          </p>
        ) : low ? (
          <p className="mt-3 text-sm font-medium text-amber-800 dark:text-amber-200">Running low</p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-violet-200/80 bg-gradient-to-br from-violet-50 via-white to-fuchsia-50 p-5 shadow-sm dark:border-violet-400/30 dark:from-violet-500/15 dark:via-background dark:to-fuchsia-500/10 lg:col-span-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-200">
          Top up
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Bought texts stay on the account.</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {usage.packs.map((pack) => {
            const larger = pack.texts >= 1000;
            return (
              <button
                key={pack.key}
                type="button"
                disabled={busyKey != null}
                onClick={() => void buy(pack.key)}
                className={cn(
                  'flex flex-col items-start rounded-xl border px-3 py-3 text-left transition duration-200',
                  'hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  'disabled:pointer-events-none disabled:opacity-60',
                  larger
                    ? 'border-violet-300/80 bg-white/80 dark:border-violet-400/40 dark:bg-violet-500/10'
                    : 'border-sky-300/80 bg-white/80 dark:border-sky-400/40 dark:bg-sky-500/10',
                )}
              >
                <span className="text-sm font-medium text-foreground">
                  {pack.texts.toLocaleString('en-GB')} texts
                </span>
                <span
                  className={cn(
                    'mt-1 text-2xl font-semibold tabular-nums',
                    larger ? 'text-violet-800 dark:text-violet-200' : 'text-sky-800 dark:text-sky-200',
                  )}
                >
                  {priceLabel(pack.pricePence)}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
