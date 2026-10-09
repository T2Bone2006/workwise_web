import 'server-only';

import type { BillingInterval } from '@/lib/billing/plans';
import { PRO_TIER_ORDER, type ProChoice, type ProTier } from '@/lib/billing/pro-plans';

/** Stripe price ids come from env so test and live differ only in env. Names are final. */
export const PRO_PLAN_PRICE_ENV: Record<ProTier, Record<BillingInterval, string>> = {
  starter: { month: 'STRIPE_PRICE_STARTER', year: 'STRIPE_PRICE_STARTER_YEARLY' },
  growth: { month: 'STRIPE_PRICE_GROWTH', year: 'STRIPE_PRICE_GROWTH_YEARLY' },
  pro: { month: 'STRIPE_PRICE_PRO', year: 'STRIPE_PRICE_PRO_YEARLY' },
};

export const EXTRA_WORKER_PRICE_ENV: Record<ProTier, Record<BillingInterval, string>> = {
  starter: { month: 'STRIPE_PRICE_EXTRA_WORKER_STARTER', year: 'STRIPE_PRICE_EXTRA_WORKER_STARTER_YEARLY' },
  growth: { month: 'STRIPE_PRICE_EXTRA_WORKER_GROWTH', year: 'STRIPE_PRICE_EXTRA_WORKER_GROWTH_YEARLY' },
  pro: { month: 'STRIPE_PRICE_EXTRA_WORKER_PRO', year: 'STRIPE_PRICE_EXTRA_WORKER_PRO_YEARLY' },
};

const INTERVALS: readonly BillingInterval[] = ['month', 'year'];
let warnedSharedPriceId = false;

/** server. Throws `Missing STRIPE_PRICE_STARTER_YEARLY for starter/year` when unset. */
export function proPlanPriceId(choice: ProChoice): string {
  const envName = PRO_PLAN_PRICE_ENV[choice.tier][choice.interval];
  const priceId = process.env[envName];
  if (!priceId) throw new Error(`Missing ${envName} for ${choice.tier}/${choice.interval}`);
  return priceId;
}

/** null when the env var is unset (callers must then change nothing). */
export function extraWorkerPriceIdFor(tier: ProTier, interval: BillingInterval): string | null {
  return process.env[EXTRA_WORKER_PRICE_ENV[tier][interval]] || null;
}

function reverse(map: Record<ProTier, Record<BillingInterval, string>>, priceId: string | null | undefined): ProChoice | null {
  if (!priceId) return null;
  const matches: ProChoice[] = [];
  for (const tier of PRO_TIER_ORDER) {
    for (const interval of INTERVALS) {
      const value = process.env[map[tier][interval]];
      if (value && value === priceId) matches.push({ tier, interval });
    }
  }
  if (matches.length > 1 && !warnedSharedPriceId) {
    warnedSharedPriceId = true;
    console.warn('[pro-plan-prices] two STRIPE_PRICE_ vars share a price id; using the first');
  }
  return matches[0] ?? null;
}

/** Reverse lookup over the six plan price ids; null when not one of ours. */
export function proChoiceForPriceId(priceId: string | null | undefined): ProChoice | null {
  return reverse(PRO_PLAN_PRICE_ENV, priceId);
}

/** Reverse lookup over the six extra-worker price ids → the tier and interval, or null. */
export function extraWorkerChoiceForPriceId(priceId: string | null | undefined): ProChoice | null {
  return reverse(EXTRA_WORKER_PRICE_ENV, priceId);
}

/** True for any of the six extra-worker price ids. */
export function isExtraWorkerPrice(priceId: string | null | undefined): boolean {
  return extraWorkerChoiceForPriceId(priceId) !== null;
}
