'use client';

import { Check, Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BillingInterval } from '@/lib/billing/plans';
import {
  PRO_PLANS,
  PRO_TIER_ORDER,
  clampWorkers,
  formatPoundsLong,
  proCost,
  proTodayLines,
  recommendTier,
  type ProChoice,
  type ProTier,
} from '@/lib/billing/pro-plans';

/** The slider covers the common range; the number box takes bigger teams (as on the marketing site). */
export const SLIDER_MAX = 150;
const THUMB = 26;

/** Where a worker count sits on the slider, matching the native thumb's centre. */
function trackPos(value: number): string {
  const frac = (Math.min(value, SLIDER_MAX) - 1) / (SLIDER_MAX - 1);
  return `calc(${THUMB / 2}px + (100% - ${THUMB}px) * ${frac})`;
}

function IntervalToggle({ interval, onChange }: { interval: BillingInterval; onChange: (i: BillingInterval) => void }) {
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
            : 'text-[#5E5A54] hover:text-[#0A1A2E] dark:text-[#A9B6C8] dark:hover:text-[#EAF1FB]',
        )}
      >
        {label}
      </button>
    );
  };
  return (
    <div role="group" aria-label="How often you pay" className="flex gap-1 rounded-full bg-[#F1F0EC] p-1 dark:bg-white/[0.06]">
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
        'flex-[3]',
      )}
    </div>
  );
}

function TeamSize({ workers, onWorkers }: { workers: number; onWorkers: (n: number) => void }) {
  const shown = String(workers);
  const pct = ((Math.min(workers, SLIDER_MAX) - 1) / (SLIDER_MAX - 1)) * 100;

  return (
    <div>
      <label htmlFor="pro-workers" className="text-sm font-medium text-[#0A1A2E] dark:text-[#EAF1FB]">
        How many workers do you have?
      </label>

      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <input
            id="pro-workers"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={shown}
            aria-label="Number of workers"
            style={{ width: `${Math.max(shown.length, 1) + 0.1}ch` }}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, '').slice(0, 3);
              if (digits) onWorkers(clampWorkers(Number(digits)));
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                onWorkers(clampWorkers(workers + (e.key === 'ArrowUp' ? 1 : -1)));
              }
            }}
            className="min-w-[1ch] rounded-lg bg-transparent text-[56px] font-semibold leading-none tracking-[-0.04em] text-[#0A1A2E] tabular-nums caret-[#0C66E4] outline-none focus-visible:bg-[#F1F0EC] dark:text-[#EAF1FB] dark:focus-visible:bg-white/[0.06]"
          />
          <span className="text-base text-[#5E5A54] dark:text-[#A9B6C8]">{workers === 1 ? 'worker' : 'workers'}</span>
        </div>
        <div className="mb-1 flex gap-2">
          {[
            { label: 'One fewer worker', delta: -1, Icon: Minus, disabled: workers <= 1 },
            { label: 'One more worker', delta: 1, Icon: Plus, disabled: workers >= 999 },
          ].map(({ label, delta, Icon, disabled }) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              disabled={disabled}
              onClick={() => onWorkers(clampWorkers(workers + delta))}
              className="flex size-11 items-center justify-center rounded-full border border-[#D6D5D2] text-[#0A1A2E] outline-none transition-colors hover:bg-[#F5F5F2] focus-visible:ring-4 focus-visible:ring-[#0C66E4]/30 disabled:opacity-40 dark:border-white/15 dark:text-[#EAF1FB] dark:hover:bg-white/5"
            >
              <Icon className="size-4" aria-hidden />
            </button>
          ))}
        </div>
      </div>

      <div className="relative mt-5 pb-9">
        <input
          type="range"
          min={1}
          max={SLIDER_MAX}
          step={1}
          value={Math.min(workers, SLIDER_MAX)}
          onChange={(e) => onWorkers(clampWorkers(Number(e.target.value)))}
          aria-label="Number of workers"
          aria-valuetext={`${workers} ${workers === 1 ? 'worker' : 'workers'}`}
          className={cn(
            'h-2 w-full cursor-pointer appearance-none rounded-full outline-none focus-visible:ring-4 focus-visible:ring-[#0C66E4]/30',
            '[&::-webkit-slider-thumb]:size-[26px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-4 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-[#0C66E4] [&::-webkit-slider-thumb]:shadow-[0_2px_8px_rgba(12,102,228,0.45)]',
            '[&::-moz-range-thumb]:size-[22px] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-4 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-[#0C66E4]',
          )}
          style={{ background: `linear-gradient(to right, #0C66E4 ${pct}%, rgba(110,106,99,0.22) ${pct}%)` }}
        />
        {/* Each plan's included workers, marked on the track. */}
        <ul aria-hidden className="pointer-events-none absolute inset-x-0 top-3">
          {PRO_TIER_ORDER.map((tier) => {
            const included = PRO_PLANS[tier].included;
            const passed = workers >= included;
            return (
              <li key={tier} className="absolute -translate-x-1/2" style={{ left: trackPos(included) }}>
                <span className={cn('mx-auto block h-2 w-px', passed ? 'bg-[#0C66E4]' : 'bg-[#B8B4AC] dark:bg-[#5D6E86]')} />
                <span
                  className={cn(
                    'mt-1 block whitespace-nowrap text-center text-[11px] leading-tight',
                    passed ? 'font-semibold text-[#0A4FB5] dark:text-[#8DB8FF]' : 'text-[#6E6A63] dark:text-[#93A3BA]',
                  )}
                >
                  {PRO_PLANS[tier].name}
                  <span className="block tabular-nums">{included}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function PlanRow({
  tier,
  interval,
  workers,
  selected,
  recommended,
  onSelect,
}: {
  tier: ProTier;
  interval: BillingInterval;
  workers: number;
  selected: boolean;
  recommended: boolean;
  onSelect: () => void;
}) {
  const plan = PRO_PLANS[tier];
  const cost = proCost({ tier, interval }, workers);
  const period = interval === 'month' ? 'a month' : 'a year';
  const detail =
    cost.extras > 0
      ? `${formatPoundsLong(cost.planPence)} plan + ${cost.extras} extra × ${formatPoundsLong(plan.extraPence[interval])}`
      : `${plan.included} workers included`;

  return (
    <label
      className={cn(
        'relative flex cursor-pointer items-center gap-3 rounded-2xl border p-3.5 outline-none transition-[background-color,border-color,box-shadow] duration-200',
        'has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-[#0C66E4]/30',
        selected
          ? 'border-[#0C66E4] bg-[#EEF4FE] shadow-[0_0_0_1px_#0C66E4] dark:bg-[#0C66E4]/15'
          : 'border-[#E6E5E0] bg-white hover:border-[#B9CBE8] dark:border-white/10 dark:bg-transparent dark:hover:border-white/25',
      )}
    >
      <input type="radio" name="pro_tier_choice" value={tier} checked={selected} onChange={onSelect} className="sr-only" />
      <span
        aria-hidden
        className={cn(
          'flex size-6 flex-shrink-0 items-center justify-center rounded-full',
          selected ? 'bg-[#0C66E4]' : 'border-2 border-black/15 dark:border-white/25',
        )}
      >
        {selected ? <Check className="size-3.5 text-white" strokeWidth={3.5} /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[17px] font-semibold tracking-[-0.02em] text-[#0A1A2E] dark:text-[#EAF1FB]">{plan.name}</span>
          {recommended ? (
            <span className="rounded-full bg-[#FFF1CC] px-2 py-0.5 text-[11px] font-semibold text-[#7A4B00] dark:bg-[#F0A500]/20 dark:text-[#F5BC3A]">
              Best for {workers} {workers === 1 ? 'worker' : 'workers'}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-[13px] leading-snug text-[#5E5A54] dark:text-[#A9B6C8]">{detail}</span>
      </span>
      <span className="flex-shrink-0 text-right tabular-nums">
        <span className="block text-[20px] font-semibold leading-none tracking-[-0.03em] text-[#0A1A2E] dark:text-[#EAF1FB]">
          {formatPoundsLong(cost.totalPence)}
        </span>
        <span className="mt-1 block text-[12px] text-[#6E6A63] dark:text-[#93A3BA]">{period}</span>
        {interval === 'year' ? (
          <span className="mt-0.5 block text-[12px] text-emerald-700 dark:text-emerald-300">
            {formatPoundsLong(Math.round(cost.totalPence / 12 / 100) * 100)} a month
          </span>
        ) : null}
      </span>
    </label>
  );
}

/**
 * Part 1 of Pro sign-up: team size (number box, buttons, slider with each plan marked), monthly/yearly, and the
 * three plans priced for that team, the cheapest lit. A radio group.
 */
export function ProPlanPicker({
  choice,
  workers,
  onChoice,
  onWorkers,
}: {
  choice: ProChoice;
  workers: number;
  onChoice: (choice: ProChoice) => void;
  onWorkers: (workers: number) => void;
}) {
  const best = recommendTier(workers, choice.interval).tier;

  return (
    <div className="space-y-5">
      <TeamSize workers={workers} onWorkers={onWorkers} />
      <IntervalToggle interval={choice.interval} onChange={(interval) => onChoice({ ...choice, interval })} />
      <fieldset>
        <legend className="mb-2.5 text-[13px] leading-snug text-[#5E5A54] dark:text-[#A9B6C8]">
          What each plan costs with {workers} {workers === 1 ? 'worker' : 'workers'}
        </legend>
        <div className="grid gap-2.5">
          {PRO_TIER_ORDER.map((tier) => (
            <PlanRow
              key={tier}
              tier={tier}
              interval={choice.interval}
              workers={workers}
              selected={choice.tier === tier}
              recommended={best === tier}
              onSelect={() => onChoice({ ...choice, tier })}
            />
          ))}
        </div>
      </fieldset>
      {workers > SLIDER_MAX ? (
        <p className="text-[13px] leading-relaxed text-[#5E5A54] dark:text-[#A9B6C8]">
          Running more than {SLIDER_MAX} workers? Talk to us about a custom plan.
        </p>
      ) : null}
    </div>
  );
}

/** "What you pay today": the plan plus any extra workers already in the team size they entered. */
export function ProTodayStrip({ choice, workers }: { choice: ProChoice; workers: number }) {
  const lines = proTodayLines(choice, workers);
  return (
    <section aria-label="What you pay today" className="relative overflow-hidden rounded-2xl bg-[#F5F7FB] p-4 pl-5 dark:bg-white/[0.04]">
      <span aria-hidden className="absolute inset-y-0 left-0 w-1.5 bg-[#0C66E4]" />
      <h2 className="text-[13px] font-semibold text-[#3D4A5C] dark:text-[#C3CEDD]">What you pay today</h2>
      <p className="mt-1.5 text-pretty text-[17px] font-semibold leading-snug tracking-[-0.01em] text-[#0A1A2E] dark:text-[#EAF1FB]">
        {lines.amount}
      </p>
      <p className="mt-2 text-[13px] leading-relaxed text-[#5E6B7D] dark:text-[#A9B6C8]">{lines.detail}</p>
    </section>
  );
}
