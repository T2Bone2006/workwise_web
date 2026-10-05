// lib/billing/plans.ts — no 'server-only' import: the sign-up page and the
// Plan & billing page show labels and prices from here. Price ids are read
// from process.env only inside the functions marked "server".

import type { Product } from '@/lib/data/tenant-products';

export type PlanKey = 'rounds' | 'lite' | 'both';
export type BillingInterval = 'month' | 'year';
export type PlanChoice = { plan: PlanKey; interval: BillingInterval };

export type PlanInfo = {
  key: PlanKey;
  label: string; // 'Rounds' | 'Lite' | 'Rounds + Lite'
  products: ReadonlyArray<'rounds' | 'lite'>;
  pence: Record<BillingInterval, number>; // VAT-inclusive
};

export const PLANS: Record<PlanKey, PlanInfo> = {
  rounds: { key: 'rounds', label: 'Rounds', products: ['rounds'], pence: { month: 3500, year: 35000 } },
  lite: { key: 'lite', label: 'Lite', products: ['lite'], pence: { month: 3500, year: 35000 } },
  both: { key: 'both', label: 'Rounds + Lite', products: ['rounds', 'lite'], pence: { month: 5900, year: 59000 } },
};

export const PLAN_KEYS: readonly PlanKey[] = ['rounds', 'lite', 'both'];

const INTERVALS: readonly BillingInterval[] = ['month', 'year'];

export function isPlanKey(v: unknown): v is PlanKey {
  return v === 'rounds' || v === 'lite' || v === 'both';
}

export function isBillingInterval(v: unknown): v is BillingInterval {
  return v === 'month' || v === 'year';
}

/** Reads ?product= / ?plan= and ?interval= from a URL or form. Unknown → rounds / month. */
export function parsePlanChoice(input: { plan?: unknown; product?: unknown; interval?: unknown }): PlanChoice {
  const plan = isPlanKey(input.plan) ? input.plan : isPlanKey(input.product) ? input.product : 'rounds';
  const interval = isBillingInterval(input.interval) ? input.interval : 'month';
  return { plan, interval };
}

/** "£35 a month", "£350 a year", "£29.50" style money (whole pounds without .00). */
export function formatPence(pence: number): string {
  const sign = pence < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(pence));
  const pounds = Math.floor(abs / 100);
  const remainder = abs % 100;
  const body = remainder === 0 ? String(pounds) : `${pounds}.${String(remainder).padStart(2, '0')}`;
  return `${sign}£${body}`;
}

export function priceLabel(choice: PlanChoice): string {
  const period = choice.interval === 'month' ? 'a month' : 'a year';
  return `${formatPence(PLANS[choice.plan].pence[choice.interval])} ${period}`;
}

/** One month's price of a plan (used for the referral credit and the referee's yearly coupon). */
export function monthlyPence(plan: PlanKey): number {
  return PLANS[plan].pence.month;
}

/** The plan that unlocks exactly these products, or null (e.g. [] or Pro tiers). */
export function planForProducts(products: ReadonlyArray<Product>): PlanKey | null {
  const set = new Set(products);
  if (set.size === 1 && set.has('rounds')) return 'rounds';
  if (set.size === 1 && set.has('lite')) return 'lite';
  if (set.size === 2 && set.has('rounds') && set.has('lite')) return 'both';
  return null;
}

// ── server: Stripe price ids ────────────────────────────────────────────────
export const PRICE_ENV: Record<PlanKey, Record<BillingInterval, string>> = {
  rounds: { month: 'STRIPE_PRICE_ROUNDS', year: 'STRIPE_PRICE_ROUNDS_YEARLY' },
  lite: { month: 'STRIPE_PRICE_LITE', year: 'STRIPE_PRICE_LITE_YEARLY' },
  both: { month: 'STRIPE_PRICE_BOTH', year: 'STRIPE_PRICE_BOTH_YEARLY' },
};

const PRO_PRICE_ENV = {
  starter: 'STRIPE_PRICE_STARTER',
  growth: 'STRIPE_PRICE_GROWTH',
  pro: 'STRIPE_PRICE_PRO',
} as const;

let warnedSharedPriceId = false;

/** server. Throws `Missing STRIPE_PRICE_… for rounds/year` when unset. */
export function priceIdFor(choice: PlanChoice): string {
  const envName = PRICE_ENV[choice.plan][choice.interval];
  const priceId = process.env[envName];
  if (!priceId) {
    throw new Error(`Missing ${envName} for ${choice.plan}/${choice.interval}`);
  }
  return priceId;
}

/** server. Reverse lookup over the six env ids; null when not one of ours. */
export function choiceForPriceId(priceId: string | null | undefined): PlanChoice | null {
  if (!priceId) return null;
  const matches: PlanChoice[] = [];
  for (const plan of PLAN_KEYS) {
    for (const interval of INTERVALS) {
      const value = process.env[PRICE_ENV[plan][interval]];
      if (!value) continue;
      if (value === priceId) matches.push({ plan, interval });
    }
  }
  if (matches.length > 1 && !warnedSharedPriceId) {
    warnedSharedPriceId = true;
    console.warn('[plans] two STRIPE_PRICE_ vars share a price id; using the first');
  }
  return matches[0] ?? null;
}

/** server. Products a Stripe price unlocks: plan prices → their products;
 *  STRIPE_PRICE_STARTER/GROWTH/PRO → ['starter'] etc.; unknown → []. */
export function productsForPriceId(priceId: string | null | undefined): Product[] {
  if (!priceId) return [];
  const choice = choiceForPriceId(priceId);
  if (choice) return [...PLANS[choice.plan].products];
  for (const product of ['starter', 'growth', 'pro'] as const) {
    const value = process.env[PRO_PRICE_ENV[product]];
    if (value && value === priceId) return [product];
  }
  return [];
}

// ── changes ────────────────────────────────────────────────────────────────
export type ChangeKind = 'same' | 'up_now' | 'down_at_renewal' | 'not_offered';

/**
 * up_now:          adds a product (rounds|lite → both) at the same or a longer
 *                  interval, or month → year on the same plan.
 * down_at_renewal: removes a product (both → rounds|lite) at the same or a
 *                  shorter interval, or year → month on the same plan.
 * not_offered:     rounds ↔ lite; adding a product while going year → month;
 *                  dropping a product while going month → year.
 */
export function classifyChange(from: PlanChoice, to: PlanChoice): ChangeKind {
  if (from.plan === to.plan && from.interval === to.interval) return 'same';

  const swap =
    (from.plan === 'rounds' && to.plan === 'lite') || (from.plan === 'lite' && to.plan === 'rounds');
  if (swap) return 'not_offered';

  const addsProduct = from.plan !== 'both' && to.plan === 'both';
  const dropsProduct = from.plan === 'both' && to.plan !== 'both';
  const intervalUp = from.interval === 'month' && to.interval === 'year';
  const intervalDown = from.interval === 'year' && to.interval === 'month';
  const intervalSame = from.interval === to.interval;

  if (addsProduct && intervalDown) return 'not_offered';
  if (dropsProduct && intervalUp) return 'not_offered';
  if (addsProduct && (intervalSame || intervalUp)) return 'up_now';
  if (from.plan === to.plan && intervalUp) return 'up_now';
  if (dropsProduct && (intervalSame || intervalDown)) return 'down_at_renewal';
  if (from.plan === to.plan && intervalDown) return 'down_at_renewal';

  return 'not_offered';
}
