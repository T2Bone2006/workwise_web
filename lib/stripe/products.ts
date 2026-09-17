import type { Product } from '@/lib/data/tenant-products';

/**
 * Maps WorkWise products to Stripe Price ids, configured by environment so
 * test and live modes differ only in env.
 *
 *   STRIPE_PRICE_LITE      monthly Lite price (£49; launch discount is a Stripe coupon)
 *   STRIPE_PRICE_ROUNDS    monthly Rounds price (£49)
 *   STRIPE_PRICE_STARTER   Pro tiers: per-seat quantity prices; defined now,
 *   STRIPE_PRICE_GROWTH    self-serve checkout for them is a later phase.
 *   STRIPE_PRICE_PRO
 */
const PRICE_ENV: Record<Product, string> = {
  lite: 'STRIPE_PRICE_LITE',
  rounds: 'STRIPE_PRICE_ROUNDS',
  starter: 'STRIPE_PRICE_STARTER',
  growth: 'STRIPE_PRICE_GROWTH',
  pro: 'STRIPE_PRICE_PRO',
};

/** Products a visitor can buy without talking to us. */
export const SELF_SERVE_PRODUCTS: readonly Product[] = ['rounds', 'lite'];

export const PRODUCT_LABELS: Record<Product, string> = {
  lite: 'WorkWise Lite',
  rounds: 'WorkWise Rounds',
  starter: 'WorkWise Starter',
  growth: 'WorkWise Growth',
  pro: 'WorkWise Pro',
};

export const TRIAL_DAYS = 14;

export function isSelfServeProduct(value: unknown): value is 'rounds' | 'lite' {
  return value === 'rounds' || value === 'lite';
}

export function priceIdForProduct(product: Product): string {
  const priceId = process.env[PRICE_ENV[product]];
  if (!priceId) {
    throw new Error(`Missing ${PRICE_ENV[product]} for product "${product}"`);
  }
  return priceId;
}

/** Reverse lookup used by the webhook: which product does a Stripe price represent? */
export function productForPriceId(priceId: string | null | undefined): Product | null {
  if (!priceId) return null;
  for (const product of Object.keys(PRICE_ENV) as Product[]) {
    if (process.env[PRICE_ENV[product]] === priceId) return product;
  }
  return null;
}
