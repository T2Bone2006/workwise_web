import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  choiceForPriceId,
  classifyChange,
  formatPence,
  monthlyPence,
  parsePlanChoice,
  planForProducts,
  priceIdFor,
  priceLabel,
  productsForPriceId,
  type BillingInterval,
  type PlanKey,
} from '@/lib/billing/plans';

const PRICE_VARS = [
  'STRIPE_PRICE_ROUNDS',
  'STRIPE_PRICE_LITE',
  'STRIPE_PRICE_BOTH',
  'STRIPE_PRICE_ROUNDS_YEARLY',
  'STRIPE_PRICE_LITE_YEARLY',
  'STRIPE_PRICE_BOTH_YEARLY',
  'STRIPE_PRICE_STARTER',
  'STRIPE_PRICE_GROWTH',
  'STRIPE_PRICE_PRO',
] as const;

const saved: Record<string, string | undefined> = {};

function setPrices(vars: Partial<Record<(typeof PRICE_VARS)[number], string>>) {
  for (const key of PRICE_VARS) {
    if (!(key in saved)) saved[key] = process.env[key];
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(vars)) {
    process.env[key] = value;
  }
}

afterEach(() => {
  for (const key of Object.keys(saved)) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    delete saved[key];
  }
});

function choice(plan: PlanKey, interval: BillingInterval) {
  return { plan, interval };
}

describe('classifyChange', () => {
  it('covers every offered and refused change', () => {
    expect(classifyChange(choice('rounds', 'month'), choice('both', 'month'))).toBe('up_now');
    expect(classifyChange(choice('rounds', 'month'), choice('both', 'year'))).toBe('up_now');
    expect(classifyChange(choice('rounds', 'month'), choice('rounds', 'year'))).toBe('up_now');
    expect(classifyChange(choice('rounds', 'year'), choice('both', 'year'))).toBe('up_now');
    expect(classifyChange(choice('rounds', 'year'), choice('both', 'month'))).toBe('not_offered');
    expect(classifyChange(choice('both', 'month'), choice('rounds', 'month'))).toBe('down_at_renewal');
    expect(classifyChange(choice('both', 'year'), choice('lite', 'month'))).toBe('down_at_renewal');
    expect(classifyChange(choice('both', 'month'), choice('lite', 'year'))).toBe('not_offered');
    expect(classifyChange(choice('rounds', 'year'), choice('rounds', 'month'))).toBe('down_at_renewal');
    expect(classifyChange(choice('rounds', 'month'), choice('lite', 'month'))).toBe('not_offered');
    expect(classifyChange(choice('lite', 'year'), choice('lite', 'year'))).toBe('same');
  });
});

describe('parsePlanChoice', () => {
  it('reads product and plan, and falls back when unknown', () => {
    expect(parsePlanChoice({ product: 'both', interval: 'year' })).toEqual(choice('both', 'year'));
    expect(parsePlanChoice({ product: 'rounds' })).toEqual(choice('rounds', 'month'));
    expect(parsePlanChoice({ plan: 'lite', product: 'rounds', interval: 'year' })).toEqual(choice('lite', 'year'));
    expect(parsePlanChoice({ product: 'starter', interval: 'weekly' })).toEqual(choice('rounds', 'month'));
    expect(parsePlanChoice({})).toEqual(choice('rounds', 'month'));
  });
});

describe('formatPence', () => {
  it('drops .00, keeps pence, and signs credits', () => {
    expect(formatPence(3500)).toBe('£35');
    expect(formatPence(2950)).toBe('£29.50');
    expect(formatPence(0)).toBe('£0');
    expect(formatPence(-3500)).toBe('-£35');
    expect(priceLabel(choice('both', 'year'))).toBe('£590 a year');
    expect(priceLabel(choice('rounds', 'month'))).toBe('£35 a month');
    expect(monthlyPence('both')).toBe(5900);
    expect(monthlyPence('lite')).toBe(3500);
  });
});

describe('planForProducts', () => {
  it('matches a plan only when the products are exactly that plan', () => {
    expect(planForProducts(['rounds'])).toBe('rounds');
    expect(planForProducts(['lite', 'rounds'])).toBe('both');
    expect(planForProducts([])).toBeNull();
    expect(planForProducts(['starter'])).toBeNull();
    expect(planForProducts(['rounds', 'pro'])).toBeNull();
  });
});

describe('price ids', () => {
  it('maps a bundle price to both products and ignores empty env', () => {
    setPrices({
      STRIPE_PRICE_BOTH: 'price_both',
      STRIPE_PRICE_ROUNDS: '',
      STRIPE_PRICE_STARTER: 'price_starter',
    });
    expect(productsForPriceId('price_both')).toEqual(['rounds', 'lite']);
    expect(choiceForPriceId('price_both')).toEqual(choice('both', 'month'));
    expect(choiceForPriceId('price_missing')).toBeNull();
    expect(productsForPriceId('price_starter')).toEqual(['starter']);
    expect(productsForPriceId('price_other')).toEqual([]);
    expect(productsForPriceId(null)).toEqual([]);
    expect(priceIdFor(choice('both', 'month'))).toBe('price_both');
    expect(() => priceIdFor(choice('rounds', 'year'))).toThrow('Missing STRIPE_PRICE_ROUNDS_YEARLY for rounds/year');
  });

  it('warns once when two env vars share a price id and keeps the first match', () => {
    setPrices({
      STRIPE_PRICE_ROUNDS: 'price_shared',
      STRIPE_PRICE_LITE: 'price_shared',
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(choiceForPriceId('price_shared')).toEqual(choice('rounds', 'month'));
    expect(choiceForPriceId('price_shared')).toEqual(choice('rounds', 'month'));
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
