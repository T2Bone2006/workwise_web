import type { Product } from '@/lib/data/tenant-products';
import { productsForPriceId } from '@/lib/billing/plans';

/**
 * Maps WorkWise products to Stripe Price ids, configured by environment so
 * test and live modes differ only in env.
 *
 *   STRIPE_PRICE_LITE      monthly Lite price (amounts live in lib/billing/plans.ts)
 *   STRIPE_PRICE_ROUNDS    monthly Rounds price
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

export function isSelfServeProduct(value: unknown): value is 'rounds' | 'lite' | 'both' {
  return value === 'rounds' || value === 'lite' || value === 'both';
}

export function priceIdForProduct(product: Product): string {
  const priceId = process.env[PRICE_ENV[product]];
  if (!priceId) {
    throw new Error(`Missing ${PRICE_ENV[product]} for product "${product}"`);
  }
  return priceId;
}

/**
 * @deprecated — use productsForPriceId (a bundle price unlocks two products)
 * Reverse lookup used by the webhook: the first product a Stripe price unlocks.
 */
export function productForPriceId(priceId: string | null | undefined): Product | null {
  return productsForPriceId(priceId)[0] ?? null;
}
