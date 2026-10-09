// lib/billing/pro-plans.ts — no 'server-only' import: the sign-up page, the Plan & billing page and the
// dialogs show labels and prices from here. Stripe price ids live in pro-plan-prices.ts (server only).
//
// One table for every Pro plan and its price, monthly and yearly. WorkWise is not VAT registered, so these are the prices customers pay.
// A year is ten months' price for the plan AND for each extra worker (owner, 2026-10-08).
// Mirrors PRO_TIERS in workwise_site/lib/site.ts (the pricing page): change both together.

import type { BillingInterval } from '@/lib/billing/plans';
import { PRO_ALLOWANCES, PRO_TIER_ORDER, YEARLY_MONTHS, type ProTier } from '@/lib/billing/pro-allowance';

export { PRO_TIER_ORDER };
export type { ProTier };

export type ProChoice = { tier: ProTier; interval: BillingInterval };

export type ProPlanInfo = {
  tier: ProTier;
  name: string;
  /** Workers included in the plan (10 / 35 / 70). */
  included: number;
  /** The plan. month 14900, year 149000 for Starter. */
  pence: Record<BillingInterval, number>;
  /** One extra worker. month 1200, year 12000 for Starter. */
  extraPence: Record<BillingInterval, number>;
};

export { YEARLY_MONTHS };

function build(tier: ProTier): ProPlanInfo {
  const a = PRO_ALLOWANCES[tier];
  const month = a.planMonthlyPounds * 100;
  const extraMonth = a.extraWorkerPounds * 100;
  return {
    tier,
    name: a.name,
    included: a.included,
    pence: { month, year: month * YEARLY_MONTHS },
    extraPence: { month: extraMonth, year: extraMonth * YEARLY_MONTHS },
  };
}

export const PRO_PLANS: Record<ProTier, ProPlanInfo> = {
  starter: build('starter'),
  growth: build('growth'),
  pro: build('pro'),
};

export function isProTier(v: unknown): v is ProTier {
  return v === 'starter' || v === 'growth' || v === 'pro';
}

function isInterval(v: unknown): v is BillingInterval {
  return v === 'month' || v === 'year';
}

/** Reads ?tier= (or ?plan=) and ?interval= from a URL or form. Unknown tier → growth (the most popular), unknown interval → month. */
export function parseProChoice(input: { tier?: unknown; plan?: unknown; interval?: unknown }): ProChoice {
  const tier = isProTier(input.tier) ? input.tier : isProTier(input.plan) ? input.plan : 'growth';
  const interval = isInterval(input.interval) ? input.interval : 'month';
  return { tier, interval };
}

/** "£1,490", "£149", "£58.36": whole pounds without .00, thousands separated, pence only when not whole. */
export function formatPoundsLong(pence: number): string {
  const sign = pence < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(pence));
  const pounds = Math.floor(abs / 100);
  const remainder = abs % 100;
  const grouped = pounds.toLocaleString('en-GB');
  return remainder === 0 ? `${sign}£${grouped}` : `${sign}£${grouped}.${String(remainder).padStart(2, '0')}`;
}

/** "£449 a month" / "£4,490 a year". */
export function proPriceLabel(choice: ProChoice): string {
  const period = choice.interval === 'month' ? 'a month' : 'a year';
  return `${formatPoundsLong(PRO_PLANS[choice.tier].pence[choice.interval])} ${period}`;
}

/** "£12 a month" / "£120 a year" for one extra worker (callers add VAT wording). */
export function extraWorkerLabel(choice: ProChoice): string {
  const period = choice.interval === 'month' ? 'a month' : 'a year';
  return `${formatPoundsLong(PRO_PLANS[choice.tier].extraPence[choice.interval])} ${period}`;
}

/**
 * The two lines under "What you pay today". The amount is the price for this team: the plan, plus each
 * worker already past the allowance. Inside the allowance, the detail says extras start only if the team grows.
 */
export function proTodayLines(choice: ProChoice, workers: number): { amount: string; detail: string } {
  const plan = PRO_PLANS[choice.tier];
  const cost = proCost(choice, workers);
  const then = choice.interval === 'month' ? 'then every month' : 'then every year';
  const yearly =
    choice.interval === 'year' ? ' Add one part-way through the year and you pay only for the months left.' : '';
  const amount = `${formatPoundsLong(cost.totalPence)} for ${plan.name}, ${then}.`;
  if (cost.extras > 0) {
    return {
      amount,
      detail: `${formatPoundsLong(cost.planPence)} for the plan, plus ${cost.extras} extra × ${formatPoundsLong(plan.extraPence[choice.interval])}.${yearly}`,
    };
  }
  return {
    amount,
    detail: `Extra workers (${extraWorkerLabel(choice)} each) are only added when your team grows past ${plan.included}, and we ask you first.${yearly}`,
  };
}

/** Whole workers as an integer 1–999. NaN, negatives and over-large values are clamped. */
export function clampWorkers(n: unknown): number {
  const value = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(value)) return 1;
  return Math.min(999, Math.max(1, Math.round(value)));
}

/** What a business pays at its renewal for this many workers: the plan plus each worker beyond `included`. */
export function proCost(
  choice: ProChoice,
  workers: number,
): { planPence: number; extras: number; extrasPence: number; totalPence: number } {
  const plan = PRO_PLANS[choice.tier];
  const planPence = plan.pence[choice.interval];
  const extras = Math.max(0, Math.floor(workers) - plan.included);
  const extrasPence = extras * plan.extraPence[choice.interval];
  return { planPence, extras, extrasPence, totalPence: planPence + extrasPence };
}

/** Cheapest tier for this many workers at this interval; a tie goes to the bigger plan (same as the pricing page). */
export function recommendTier(
  workers: number,
  interval: BillingInterval,
): { tier: ProTier; cost: ReturnType<typeof proCost> } {
  const n = clampWorkers(workers);
  let best: { tier: ProTier; cost: ReturnType<typeof proCost> } | null = null;
  for (const tier of PRO_TIER_ORDER) {
    const cost = proCost({ tier, interval }, n);
    if (!best || cost.totalPence <= best.cost.totalPence) best = { tier, cost };
  }
  return best as { tier: ProTier; cost: ReturnType<typeof proCost> };
}

export type ProChangeKind = 'same' | 'up_now' | 'not_offered';

/**
 * What a self-serve Pro owner may do. Same tier and interval is 'same'. A different interval is 'not_offered'
 * (switching monthly and yearly goes through us). A higher tier on the same interval is 'up_now' (pro-rata, now).
 * A lower tier is 'not_offered' (going down goes through us).
 */
export function classifyProChange(from: ProChoice, to: ProChoice): ProChangeKind {
  if (from.tier === to.tier && from.interval === to.interval) return 'same';
  if (from.interval !== to.interval) return 'not_offered';
  return PRO_TIER_ORDER.indexOf(to.tier) > PRO_TIER_ORDER.indexOf(from.tier) ? 'up_now' : 'not_offered';
}
