'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, CalendarClock, Check, Lock, PiggyBank, Route, Sparkles, Undo2 } from 'lucide-react';
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

type BlockLook = { block: string; glow: string; cta: string };

/** One solid colour per offer: Lite is violet, Rounds is blue, yearly is green. */
const BLOCK_LOOK: Record<'lite' | 'rounds' | 'yearly', BlockLook> = {
  lite: {
    block: 'bg-gradient-to-br from-violet-600 via-purple-600 to-fuchsia-600',
    glow: 'bg-amber-300/30',
    cta: 'bg-amber-300 text-slate-900 hover:bg-amber-200',
  },
  rounds: {
    block: 'bg-gradient-to-br from-blue-600 via-blue-600 to-indigo-700',
    glow: 'bg-sky-300/25',
    cta: 'bg-amber-300 text-slate-900 hover:bg-amber-200',
  },
  yearly: {
    block: 'bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-700',
    glow: 'bg-amber-300/25',
    cta: 'bg-white text-emerald-800 hover:bg-emerald-50',
  },
};

function OfferBlock({
  look,
  badge,
  BadgeIcon,
  headline,
  price,
  priceNote,
  pill,
  bullets,
  action,
  locked,
}: {
  look: keyof typeof BLOCK_LOOK;
  badge: string;
  BadgeIcon: typeof Sparkles;
  headline: string;
  price: string;
  priceNote: string;
  pill: string | null;
  bullets: string[];
  action: React.ReactNode;
  locked?: boolean;
}) {
  const style = BLOCK_LOOK[look];
  return (
    <div
      className={cn(
        'relative flex flex-col overflow-hidden rounded-2xl p-5 text-white shadow-lg sm:p-6',
        style.block,
        locked && 'saturate-50'
      )}
    >
      <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 size-44 rounded-full bg-white/15" />
      <div aria-hidden className={cn('pointer-events-none absolute -bottom-16 -left-10 size-40 rounded-full', style.glow)} />
      <div className="relative flex h-full flex-col">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur-sm">
          <BadgeIcon className="size-3.5" aria-hidden />
          {badge}
        </span>
        <p className="mt-4 text-2xl font-bold tracking-tight">{headline}</p>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
          <span className="text-4xl font-extrabold tracking-tight tabular-nums">{price}</span>
          <span className="text-sm text-white/85">{priceNote}</span>
        </p>
        {pill ? (
          <p className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-full bg-amber-300 px-3 py-1 text-[13px] font-bold text-slate-900">
            <PiggyBank className="size-3.5" aria-hidden />
            {pill}
          </p>
        ) : null}
        <ul className="mt-4 space-y-2 text-sm">
          {bullets.map((text) => (
            <li key={text} className="flex items-start gap-2">
              <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-white text-slate-900">
                <Check className="size-3" aria-hidden />
              </span>
              <span className="text-white/95">{text}</span>
            </li>
          ))}
        </ul>
        <div className="mt-5">{action}</div>
      </div>
    </div>
  );
}

function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

export function ChangePlanOptions({
  choice,
  periodEnd,
  pending,
  offerActive = false,
  offerLabel = null,
  offerEndsAt = null,
  run,
}: {
  choice: PlanChoice;
  periodEnd: string;
  pending: boolean;
  /** A discount is still on the subscription: yearly waits until it has finished. */
  offerActive?: boolean;
  offerLabel?: string | null;
  offerEndsAt?: string | null;
  run: PlanActionRun;
}) {
  const roundsOnly = choice.plan === 'rounds';
  const yearlyTerm = choice.interval === 'year';
  const offers = offersFor(choice, periodEnd, offerActive).filter((offer) => !(roundsOnly && offer.title === 'Add Lite'));
  const [picked, setPicked] = useState<{ offer: PlanOffer; nonce: string } | null>(null);
  if (!roundsOnly && offers.length === 0) return null;

  const period = yearlyTerm ? 'a year' : 'a month';
  const bothPence = PLANS.both.pence[choice.interval];
  const separatePence = PLANS.rounds.pence[choice.interval] + PLANS.lite.pence[choice.interval];
  const bothPill = `Both for ${formatPence(bothPence)}, not ${formatPence(separatePence)}`;
  const addPrice = `+${formatPence(bothPence - PLANS[roundsOnly ? 'rounds' : 'lite'].pence[choice.interval])}`;

  const addRounds = offers.find((o) => o.title === 'Add Rounds');
  const yearly = offers.find((o) => o.title === 'Switch to yearly');
  const listed = offers.filter((o) => o !== addRounds && o !== yearly);

  const openOffer = (offer: PlanOffer) => setPicked({ offer, nonce: crypto.randomUUID() });

  const yearlyFigures = yearly
    ? {
        yearPence: PLANS[choice.plan].pence.year,
        twelvePence: PLANS[choice.plan].pence.month * 12,
      }
    : null;
  const endsOn = shortDate(offerEndsAt);

  return (
    <section aria-labelledby="change-plan-heading">
      <h2 id="change-plan-heading" className="text-sm font-semibold">
        Change your plan
      </h2>

      {roundsOnly || addRounds || yearly ? (
        <div className={cn('mt-3 grid gap-4', roundsOnly || addRounds ? (yearly ? 'sm:grid-cols-2' : '') : '')}>
          {roundsOnly ? (
            <OfferBlock
              look="lite"
              badge="Add on"
              BadgeIcon={Sparkles}
              headline="Add Lite to your Rounds"
              price={addPrice}
              priceNote={period}
              pill={bothPill}
              bullets={[
                'A quote assistant on your website',
                'Won jobs land straight on your round',
                'Everything in Rounds stays as it is',
              ]}
              action={
                <Button asChild className={cn('w-full gap-1.5 font-semibold shadow-sm', BLOCK_LOOK.lite.cta)}>
                  <Link href="/add-lite">
                    See Lite
                    <ArrowUpRight className="size-4" aria-hidden />
                  </Link>
                </Button>
              }
            />
          ) : null}
          {addRounds ? (
            <OfferBlock
              look="rounds"
              badge="Add on"
              BadgeIcon={Route}
              headline="Add Rounds to your Lite"
              price={addPrice}
              priceNote={period}
              pill={bothPill}
              bullets={[
                'Plan your round and see who is due',
                'Take payments and chase what is owed',
                'Keep your books ready for your accountant',
              ]}
              action={
                <Button
                  type="button"
                  className={cn('w-full gap-1.5 font-semibold shadow-sm', BLOCK_LOOK.rounds.cta)}
                  disabled={pending}
                  onClick={() => openOffer(addRounds)}
                >
                  Add Rounds
                  <ArrowUpRight className="size-4" aria-hidden />
                </Button>
              }
            />
          ) : null}
          {yearly && yearlyFigures ? (
            <OfferBlock
              look="yearly"
              badge={offerActive ? 'Opens when your offer ends' : 'Billed once a year'}
              BadgeIcon={offerActive ? Lock : CalendarClock}
              headline="Pay yearly and get 2 months free"
              price={`${formatPence(yearlyFigures.yearPence)} a year`}
              priceNote={`instead of ${formatPence(yearlyFigures.twelvePence)} over 12 months`}
              pill={`Save ${formatPence(yearlyFigures.twelvePence - yearlyFigures.yearPence)}`}
              locked={offerActive}
              bullets={
                offerActive
                  ? [
                      `You are on an offer${offerLabel ? ` (${offerLabel})` : ''}, so yearly isn't available yet.`,
                      endsOn ? `It unlocks when the offer ends on ${endsOn}.` : 'It unlocks as soon as the offer has finished.',
                    ]
                  : ["Your year starts the day you switch, and we take back what you haven't used this month."]
              }
              action={
                <Button
                  type="button"
                  className={cn('w-full font-semibold shadow-sm', BLOCK_LOOK.yearly.cta)}
                  disabled={pending || yearly.disabled}
                  onClick={() => openOffer(yearly)}
                >
                  {yearly.disabled ? 'Not available yet' : 'Switch to yearly'}
                </Button>
              }
            />
          ) : null}
        </div>
      ) : null}

      {listed.length > 0 ? (
        <Card className="glass-card mt-4 gap-0 border-border/80 py-0">
          <ul className="divide-y divide-border/60">
            {listed.map((offer) => {
              const Icon = ICON[offer.icon];
              return (
                <li
                  key={`${offer.target.plan}-${offer.target.interval}-${offer.title}`}
                  className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span
                      className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', ICON_TONE[offer.icon])}
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
                    {offer.price ? <p className="text-sm font-semibold tabular-nums">{offer.price}</p> : null}
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full basis-full sm:w-auto sm:basis-auto"
                      disabled={pending || offer.disabled}
                      onClick={() => openOffer(offer)}
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
