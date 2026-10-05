'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CalendarClock, ChevronRight, MessageCircle, Route, Sparkles, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { classifyChange, formatPence, PLANS, priceLabel, type PlanChoice } from '@/lib/billing/plans';
import { cn } from '@/lib/utils';
import { formatBillDate, type PlanActionRun } from './current-plan-card';
import { ChangePlanDialog } from './change-plan-dialog';

export type PlanOffer = {
  target: PlanChoice;
  title: string;
  detail: string;
  price: string | null;
  emphasis: 'now' | 'plain';
  icon: 'lite' | 'rounds' | 'calendar' | 'undo';
  /** Shown but not pickable (yearly while a half-price or free-month offer is still running). */
  disabled?: boolean;
};

function renewal(periodEnd: string): string {
  return formatBillDate(periodEnd) || 'your next renewal';
}

/**
 * Rows the trader can pick. Combined add-and-switch changes are not offered.
 * The yearly line compares twelve monthly prices with the yearly price (the
 * card's "instead of £420" wording). The confirm dialog shows Stripe's preview only.
 */
export function offersFor(choice: PlanChoice, periodEnd: string, offerActive = false): PlanOffer[] {
  const offers: PlanOffer[] = [];
  const when = renewal(periodEnd);
  const { plan, interval } = choice;

  if (plan === 'rounds' || plan === 'lite') {
    const target: PlanChoice = { plan: 'both', interval };
    if (classifyChange(choice, target) === 'up_now') {
      const delta = PLANS.both.pence[interval] - PLANS[plan].pence[interval];
      const addingLite = plan === 'rounds';
      offers.push({
        target,
        title: addingLite ? 'Add Lite' : 'Add Rounds',
        detail: addingLite
          ? 'A quote assistant on your website. Won jobs land on your round.'
          : 'Plan the round, get paid, keep the books.',
        price: `+${formatPence(delta)} ${interval === 'month' ? 'a month' : 'a year'}`,
        emphasis: addingLite ? 'now' : 'plain',
        icon: addingLite ? 'lite' : 'rounds',
      });
    }
  }

  if (interval === 'month') {
    const target: PlanChoice = { plan, interval: 'year' };
    if (classifyChange(choice, target) === 'up_now') {
      const year = PLANS[plan].pence.year;
      const twelveMonths = PLANS[plan].pence.month * 12;
      offers.push({
        target,
        title: 'Switch to yearly',
        detail: offerActive
          ? 'Available once your current offer has finished.'
          : `2 months free: ${formatPence(year)} a year instead of ${formatPence(twelveMonths)}.`,
        price: null,
        emphasis: offerActive ? 'plain' : 'now',
        icon: 'calendar',
        disabled: offerActive,
      });
    }
  }

  if (interval === 'year') {
    const target: PlanChoice = { plan, interval: 'month' };
    if (classifyChange(choice, target) === 'down_at_renewal') {
      offers.push({
        target,
        title: 'Switch to monthly',
        detail: `From ${when}, ${priceLabel(target)}.`,
        price: null,
        emphasis: 'plain',
        icon: 'calendar',
      });
    }
  }

  if (plan === 'both') {
    for (const keep of ['rounds', 'lite'] as const) {
      const target: PlanChoice = { plan: keep, interval };
      if (classifyChange(choice, target) !== 'down_at_renewal') continue;
      const dropping = keep === 'rounds' ? 'Lite' : 'Rounds';
      offers.push({
        target,
        title: `Drop ${dropping}`,
        detail: `From ${when}, ${priceLabel(target)}. ${dropping} stays on until then.`,
        price: null,
        emphasis: 'plain',
        icon: 'undo',
      });
    }
  }

  return offers;
}

const ICON = {
  lite: Sparkles,
  rounds: Route,
  calendar: CalendarClock,
  undo: Undo2,
} as const;

const ICON_TONE = {
  lite: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  rounds: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  calendar: 'bg-muted text-muted-foreground',
  undo: 'bg-muted text-muted-foreground',
} as const;

export function ChangePlanOptions({
  choice,
  periodEnd,
  pending,
  offerActive = false,
  run,
}: {
  choice: PlanChoice;
  periodEnd: string;
  pending: boolean;
  /** A discount is still on the subscription: yearly waits until it has finished. */
  offerActive?: boolean;
  run: PlanActionRun;
}) {
  const roundsOnly = choice.plan === 'rounds';
  const offers = offersFor(choice, periodEnd, offerActive).filter((offer) => !(roundsOnly && offer.title === 'Add Lite'));
  const [picked, setPicked] = useState<{ offer: PlanOffer; nonce: string } | null>(null);
  if (!roundsOnly && offers.length === 0) return null;
  const litePrice = choice.interval === 'year' ? '+£240 a year' : '+£24 a month';

  return (
    <section aria-labelledby="change-plan-heading">
      <h2 id="change-plan-heading" className="text-sm font-semibold">
        Change your plan
      </h2>
      {roundsOnly ? (
        <div className="mt-3 flex flex-col gap-4 rounded-2xl border border-(--tone-lite-line) bg-(--tone-lite-soft) p-4 sm:flex-row sm:items-center sm:gap-5 sm:p-5">
          <div className="flex min-w-0 flex-1 items-start gap-3.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-(--look-lite-pill) text-white" aria-hidden>
              <MessageCircle className="size-[18px]" />
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-card-foreground">Add Lite to your Rounds</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                It quotes customers on your website, and won jobs land on your round.
              </p>
            </div>
          </div>
          <Button asChild className="h-10 rounded-xl bg-(--look-lite-pill) px-4 font-semibold text-white hover:bg-(--look-lite-pill)/90 sm:shrink-0">
            <Link href="/add-lite">
              See Lite, {litePrice}
              <ChevronRight className="size-4 opacity-80" aria-hidden />
            </Link>
          </Button>
        </div>
      ) : null}
      {offers.length > 0 ? (
      <Card className="glass-card mt-3 gap-0 border-border/80 py-0">
        <ul className="divide-y divide-border/60">
          {offers.map((offer) => {
            const Icon = ICON[offer.icon];
            return (
              <li
                key={`${offer.target.plan}-${offer.target.interval}-${offer.title}`}
                className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span
                    className={cn(
                      'flex size-9 shrink-0 items-center justify-center rounded-lg',
                      ICON_TONE[offer.icon]
                    )}
                    aria-hidden
                  >
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium">{offer.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{offer.detail}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
                  {offer.price ? (
                    <p className="text-sm font-semibold tabular-nums">{offer.price}</p>
                  ) : null}
                  <Button
                    type="button"
                    variant={offer.emphasis === 'now' ? 'gradient' : 'outline'}
                    className="w-full basis-full sm:w-auto sm:basis-auto"
                    disabled={pending || offer.disabled}
                    onClick={() => setPicked({ offer, nonce: crypto.randomUUID() })}
                  >
                    {offer.title}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
      ) : null}
      {picked ? (
        <ChangePlanDialog
          key={picked.nonce}
          offer={picked.offer}
          nonce={picked.nonce}
          current={choice}
          periodEnd={periodEnd}
          pending={pending}
          run={run}
          onClose={() => setPicked(null)}
        />
      ) : null}
    </section>
  );
}
