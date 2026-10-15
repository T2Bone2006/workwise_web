'use client';

import { useState, type JSX } from 'react';
import { MessageSquare, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { IconChip, LookCard, Tag } from '@/components/look';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
      <LookCard
        className="lg:col-span-3"
        title="Texts this month"
        icon={MessageSquare}
        tone={out ? 'amber' : 'rounds'}
        aside={out ? <Tag tone="amber">Out of texts</Tag> : low ? <Tag tone="amber">Running low</Tag> : undefined}
      >
        <p className="flex items-baseline gap-2">
          <span className="text-4xl font-semibold tabular-nums tracking-tight">{usage.totalLeft}</span>
          <span className="text-sm text-muted-foreground">left</span>
        </p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {usage.freeUsed} of {usage.allowance} free used · {usage.packLeft} bought left
        </p>
        <div
          className="mt-4 h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={usage.freeUsed}
          aria-valuemin={0}
          aria-valuemax={usage.allowance}
          aria-label="Free texts used this month"
        >
          <div
            className={cn('h-full rounded-full', low ? 'bg-(--tone-amber-solid)' : 'bg-(--tone-rounds-solid)')}
            style={{ width: `${pct}%` }}
          />
        </div>
        {out ? (
          <p className="mt-3 text-sm font-medium text-(--tone-amber-text)">
            You&apos;re out of texts. Reminders are paused; other messages go by email.
          </p>
        ) : null}
      </LookCard>

      <LookCard
        className="lg:col-span-2"
        title="Top up"
        icon={Plus}
        tone="rounds"
      >
        <p className="-mt-1 mb-3 text-sm text-muted-foreground">Bought texts stay on the account.</p>
        <div className="grid grid-cols-2 gap-3">
          {usage.packs.map((pack) => (
            <button
              key={pack.key}
              type="button"
              disabled={busyKey != null}
              onClick={() => void buy(pack.key)}
              className={cn(
                'flex flex-col items-start rounded-xl border border-border bg-muted/40 px-3.5 py-3 text-left transition-colors',
                'hover:border-primary/50 hover:bg-(--tone-rounds-soft) focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                'disabled:pointer-events-none disabled:opacity-60',
              )}
            >
              <span className="text-sm text-muted-foreground">{pack.texts.toLocaleString('en-GB')} texts</span>
              <span className="mt-0.5 text-2xl font-semibold tabular-nums text-(--tone-rounds-text)">
                {priceLabel(pack.pricePence)}
              </span>
            </button>
          ))}
        </div>
      </LookCard>
    </div>
  );
}

/** The header version: texts left, a thin bar, and Buy more texts (opens the packs). */
export function TextsMeterCompact(props: { usage: TextUsage }): JSX.Element {
  const { usage } = props;
  const [open, setOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const out = usage.totalLeft === 0;
  const low = usage.totalLeft <= 20;
  const pct =
    usage.allowance > 0 ? Math.min(100, Math.round((usage.freeUsed / usage.allowance) * 100)) : 0;

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
    <>
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-3.5 py-2.5 shadow-(--look-card-shadow)">
        <IconChip icon={MessageSquare} tone={low ? 'amber' : 'teal'} size="sm" />
        <div className="min-w-0">
          <p className="text-sm font-semibold tabular-nums">
            {usage.totalLeft} {usage.totalLeft === 1 ? 'text' : 'texts'} left
          </p>
          <div
            className="mt-1 h-1.5 w-32 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={usage.freeUsed}
            aria-valuemin={0}
            aria-valuemax={usage.allowance}
            aria-label="Free texts used this month"
          >
            <div
              className={cn('h-full rounded-full', low ? 'bg-(--tone-amber-solid)' : 'bg-(--tone-teal-solid)')}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {usage.freeUsed} of {usage.allowance} free used · {usage.packLeft} bought
          </p>
        </div>
        <Button size="sm" variant={out || low ? 'default' : 'outline'} onClick={() => setOpen(true)}>
          Buy more texts
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Buy more texts</DialogTitle>
            <DialogDescription>Bought texts stay on the account until you use them.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            {usage.packs.map((pack) => (
              <button
                key={pack.key}
                type="button"
                disabled={busyKey != null}
                onClick={() => void buy(pack.key)}
                className={cn(
                  'flex flex-col items-start rounded-xl border border-border bg-muted/40 px-3.5 py-3 text-left transition-colors',
                  'hover:border-primary/50 hover:bg-(--tone-rounds-soft) focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                  'disabled:pointer-events-none disabled:opacity-60',
                )}
              >
                <span className="text-sm text-muted-foreground">{pack.texts.toLocaleString('en-GB')} texts</span>
                <span className="mt-0.5 text-2xl font-semibold tabular-nums text-(--tone-rounds-text)">
                  {priceLabel(pack.pricePence)}
                </span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
