'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  formatPence,
  PLAN_KEYS,
  PLANS,
  type BillingInterval,
  type PlanChoice,
  type PlanKey,
} from '@/lib/billing/plans';

export type FoundingView = { active: boolean | null; placesLeft: number | null };

const BOTH_GRADIENT = 'linear-gradient(135deg, #0C66E4 0%, #9B30D9 100%)';

export const PLAN_LOOK: Record<PlanKey, { tagline: string; accent: string }> = {
  rounds: { tagline: 'Plan the round, get paid, keep the books.', accent: '#0C66E4' },
  lite: { tagline: 'A quote assistant on your website that prices like you.', accent: '#9B30D9' },
  both: {
    tagline: 'Win the work and run it, with won enquiries landing on your round.',
    accent: BOTH_GRADIENT,
  },
};

/** Founding half price applies to monthly plans while places last, or when the count is unknown. */
export function showsFounding(interval: BillingInterval, founding: FoundingView): boolean {
  return interval === 'month' && founding.active !== false;
}

function bundleSaving(interval: BillingInterval): number {
  return PLANS.rounds.pence[interval] + PLANS.lite.pence[interval] - PLANS.both.pence[interval];
}

function IntervalSwitch({
  interval,
  onChange,
}: {
  interval: BillingInterval;
  onChange: (interval: BillingInterval) => void;
}) {
  const option = (value: BillingInterval, label: React.ReactNode, grow: string) => {
    const on = interval === value;
    return (
      <button
        type="button"
        aria-pressed={on}
        onClick={() => onChange(value)}
        className={cn(
          grow,
          'flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[13px] font-semibold transition-colors duration-200 sm:px-3 sm:text-sm',
          'outline-none focus-visible:ring-4 focus-visible:ring-[#0C66E4]/30',
          on
            ? 'bg-white text-[#0A1A2E] shadow-[0_1px_3px_rgba(15,35,71,0.16)] dark:bg-[#2A4774] dark:text-white dark:shadow-none'
            : 'text-[#5E5A54] hover:text-[#0A1A2E] dark:text-[#A9B6C8] dark:hover:text-[#EAF1FB]'
        )}
      >
        {label}
      </button>
    );
  };

  return (
    <div
      role="group"
      aria-label="How often you pay"
      className="flex gap-1 rounded-full bg-[#F1F0EC] p-1 dark:bg-white/[0.06]"
    >
      {option('month', 'Monthly', 'flex-[2]')}
      {option(
        'year',
        <>
          Yearly
          <span aria-hidden className="text-[#B8B4AC] dark:text-[#5D6E86]">
            ·
          </span>
          <span className="text-emerald-700 dark:text-emerald-300">2 months free</span>
        </>,
        'flex-[3]'
      )}
    </div>
  );
}

const TILE: Record<PlanKey, { solid: string; tint: string; ink: string; short: string }> = {
  rounds: { solid: '#0C66E4', tint: 'bg-[#EEF4FE] dark:bg-[#0C66E4]/15', ink: 'text-[#0A4FB5] dark:text-[#8DB8FF]', short: 'Plan the round, get paid, keep the books.' },
  lite: { solid: '#9B30D9', tint: 'bg-[#F7EEFD] dark:bg-[#9B30D9]/15', ink: 'text-[#7A1FB5] dark:text-[#D9A6FF]', short: 'Your website quotes for you, day and night.' },
  both: {
    solid: 'linear-gradient(120deg, #0C66E4 0%, #5A47E0 50%, #9B30D9 100%)',
    tint: 'bg-[linear-gradient(120deg,#EEF4FE,#F7EEFD)] dark:bg-[linear-gradient(120deg,rgba(12,102,228,.15),rgba(155,48,217,.15))]',
    ink: 'text-[#4A2FB8] dark:text-[#C0B4FF]',
    short: 'Both, with won enquiries landing on your round.',
  },
};

/** One plan as a colour tile: soft tint until chosen, then solid colour with white text. */
function PlanTile({
  plan,
  interval,
  founding,
  freeThenHalf,
  selected,
  onSelect,
  wide,
}: {
  plan: PlanKey;
  interval: BillingInterval;
  founding: boolean;
  /** A referred friend on a monthly plan while founding runs: first month free, second half price. */
  freeThenHalf: boolean;
  selected: boolean;
  onSelect: () => void;
  wide?: boolean;
}) {
  const info = PLANS[plan];
  const tile = TILE[plan];
  const price = formatPence(info.pence[interval]);
  const period = interval === 'month' ? 'a month' : 'a year';
  const saving = plan === 'both' ? bundleSaving(interval) : 0;
  const half = formatPence(Math.round(info.pence.month / 2));
  const shown = freeThenHalf ? '£0' : founding ? half : price;

  return (
    <label
      className={cn(
        'relative flex cursor-pointer flex-col overflow-hidden rounded-2xl p-4 outline-none transition-[transform,box-shadow] duration-200',
        'has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-[#0C66E4]/30',
        selected
          ? 'text-white shadow-[0_18px_36px_-18px_rgba(30,40,120,0.7)]'
          : cn(tile.tint, 'hover:-translate-y-0.5'),
        wide ? 'min-h-[112px]' : 'min-h-[164px]'
      )}
      style={selected ? { background: tile.solid } : undefined}
    >
      <input type="radio" name="plan_choice" value={plan} checked={selected} onChange={onSelect} className="sr-only" />
      {selected ? (
        <span aria-hidden className="pointer-events-none absolute -bottom-12 -right-10 size-36 rounded-full border-[18px] border-white/10" />
      ) : null}

      <div className="flex items-start justify-between gap-2">
        <span className={cn('text-[17px] font-semibold tracking-[-0.02em]', !selected && 'text-[#0A1A2E] dark:text-[#EAF1FB]')}>
          {info.label}
        </span>
        <span
          aria-hidden
          className={cn(
            'flex size-6 flex-shrink-0 items-center justify-center rounded-full',
            selected ? 'bg-white' : 'border-2 border-black/15 dark:border-white/25'
          )}
        >
          {selected ? <Check className={cn('size-3.5', tile.ink)} strokeWidth={3.5} /> : null}
        </span>
      </div>
      <p className={cn('mt-1 text-pretty text-[13px] leading-snug', selected ? 'text-white/85' : 'text-[#5E5A54] dark:text-[#A9B6C8]')}>
        {tile.short}
      </p>

      <div className={cn('mt-auto flex flex-wrap items-end gap-x-2 gap-y-1 pt-3', wide && 'justify-between')}>
        <div className="tabular-nums">
          <p className={cn('text-[26px] font-semibold leading-none tracking-[-0.03em]', !selected && tile.ink)}>{shown}</p>
          <p className={cn('mt-1 text-[12px]', selected ? 'text-white/80' : 'text-[#6E6A63] dark:text-[#93A3BA]')}>
            {freeThenHalf ? (
              <>
                first month, then {half}, then <span className="sr-only">usually </span>
                {price}
              </>
            ) : founding ? (
              <>
                first 2 months, then <span className="sr-only">usually </span>
                {price}
              </>
            ) : (
              period
            )}
          </p>
        </div>
        {saving > 0 ? (
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] font-semibold',
              selected ? 'bg-white/20 text-white' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300'
            )}
          >
            Save {formatPence(saving)} {period}
          </span>
        ) : null}
      </div>
    </label>
  );
}

/** The founding offer, with the 200 places drawn as a bar. */
function FoundingMeter({ placesLeft }: { placesLeft: number | null }) {
  const taken = placesLeft != null ? Math.max(0, Math.min(200, 200 - placesLeft)) : null;
  return (
    <div className="rounded-xl bg-[#FFF6E0] px-3.5 py-3 dark:bg-[#F0A500]/10">
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <p className="font-semibold text-[#6B4100] dark:text-[#F5BC3A]">Founding offer: half price for 2 months</p>
        {placesLeft != null ? (
          <p className="flex-shrink-0 tabular-nums text-[#8A5300] dark:text-[#E9C77A]">{placesLeft} of 200 left</p>
        ) : null}
      </div>
      {taken != null ? (
        <div aria-hidden className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#F0A500]/20">
          <span className="block h-full rounded-full bg-[#F0A500]" style={{ width: `${(taken / 200) * 100}%` }} />
        </div>
      ) : null}
    </div>
  );
}

/** Part 1 of sign-up: the Monthly / Yearly switch and the three plan cards (a radio group). */
export function PlanPicker({
  choice,
  founding,
  referred = false,
  onChange,
}: {
  choice: PlanChoice;
  founding: FoundingView;
  /** Arrived with a valid referral link: monthly shows free-then-half, not the founding meter. */
  referred?: boolean;
  onChange: (choice: PlanChoice) => void;
}) {
  const withFounding = showsFounding(choice.interval, founding);
  const freeThenHalf = referred && withFounding;

  return (
    <div className="space-y-4">
      <IntervalSwitch interval={choice.interval} onChange={(interval) => onChange({ ...choice, interval })} />

      {withFounding && !freeThenHalf ? <FoundingMeter placesLeft={founding.placesLeft} /> : null}

      <fieldset>
        <legend className="sr-only">Choose your plan</legend>
        <div className="grid grid-cols-2 gap-3">
          {PLAN_KEYS.map((plan) => (
            <div key={plan} className={plan === 'both' ? 'col-span-2' : undefined}>
              <PlanTile
                plan={plan}
                interval={choice.interval}
                founding={withFounding}
                freeThenHalf={freeThenHalf}
                selected={choice.plan === plan}
                onSelect={() => onChange({ ...choice, plan })}
                wide={plan === 'both'}
              />
            </div>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
