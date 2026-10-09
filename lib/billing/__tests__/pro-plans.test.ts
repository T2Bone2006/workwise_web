import { afterEach, describe, expect, it } from 'vitest';
import {
  PRO_PLANS,
  clampWorkers,
  extraWorkerLabel,
  formatPoundsLong,
  parseProChoice,
  proCost,
  proPriceLabel,
  proTodayLines,
  recommendTier,
} from '@/lib/billing/pro-plans';
import {
  EXTRA_WORKER_PRICE_ENV,
  PRO_PLAN_PRICE_ENV,
  extraWorkerChoiceForPriceId,
  extraWorkerPriceIdFor,
  isExtraWorkerPrice,
  proChoiceForPriceId,
  proPlanPriceId,
} from '@/lib/billing/pro-plan-prices';
import { productsForPriceId } from '@/lib/billing/plans';

describe('PRO_PLANS', () => {
  it('has the agreed prices, monthly and yearly (ten months), plan and extra worker', () => {
    expect(PRO_PLANS.starter).toMatchObject({ included: 10, pence: { month: 14900, year: 149000 }, extraPence: { month: 1200, year: 12000 } });
    expect(PRO_PLANS.growth).toMatchObject({ included: 35, pence: { month: 44900, year: 449000 }, extraPence: { month: 900, year: 9000 } });
    expect(PRO_PLANS.pro).toMatchObject({ included: 70, pence: { month: 74900, year: 749000 }, extraPence: { month: 600, year: 6000 } });
  });
});

describe('money labels', () => {
  it('groups thousands and drops .00', () => {
    expect(formatPoundsLong(14900)).toBe('£149');
    expect(formatPoundsLong(149000)).toBe('£1,490');
    expect(formatPoundsLong(749000)).toBe('£7,490');
    expect(formatPoundsLong(5836)).toBe('£58.36');
    expect(formatPoundsLong(-14900)).toBe('-£149');
  });

  it('writes the price and extra-worker labels', () => {
    expect(proPriceLabel({ tier: 'growth', interval: 'month' })).toBe('£449 a month');
    expect(proPriceLabel({ tier: 'growth', interval: 'year' })).toBe('£4,490 a year');
    expect(extraWorkerLabel({ tier: 'starter', interval: 'month' })).toBe('£12 a month');
    expect(extraWorkerLabel({ tier: 'starter', interval: 'year' })).toBe('£120 a year');
  });
});

describe('parseProChoice and clampWorkers', () => {
  it('defaults to growth and monthly', () => {
    expect(parseProChoice({})).toEqual({ tier: 'growth', interval: 'month' });
    expect(parseProChoice({ tier: 'nonsense', interval: 'weekly' })).toEqual({ tier: 'growth', interval: 'month' });
    expect(parseProChoice({ plan: 'pro', interval: 'year' })).toEqual({ tier: 'pro', interval: 'year' });
    expect(parseProChoice({ tier: 'starter', plan: 'pro' })).toEqual({ tier: 'starter', interval: 'month' });
  });

  it('clamps workers to a whole number from 1 to 999', () => {
    expect(clampWorkers(0)).toBe(1);
    expect(clampWorkers(5000)).toBe(999);
    expect(clampWorkers('abc')).toBe(1);
    expect(clampWorkers(12.6)).toBe(13);
    expect(clampWorkers('40')).toBe(40);
    expect(clampWorkers(-3)).toBe(1);
  });
});

describe('proTodayLines', () => {
  it('includes extra workers already past the allowance', () => {
    expect(proTodayLines({ tier: 'growth', interval: 'month' }, 40)).toEqual({
      amount: '£494 for Growth, then every month.',
      detail: '£449 for the plan, plus 5 extra × £9.',
    });
  });

  it('keeps the plan price when the team fits', () => {
    expect(proTodayLines({ tier: 'growth', interval: 'month' }, 35).amount).toBe('£449 for Growth, then every month.');
    expect(proTodayLines({ tier: 'growth', interval: 'month' }, 35).detail).toContain('past 35');
  });

  it('uses the yearly extra price and the part-year note', () => {
    const lines = proTodayLines({ tier: 'growth', interval: 'year' }, 40);
    expect(lines.amount).toBe('£4,940 for Growth, then every year.');
    expect(lines.detail).toBe(
      '£4,490 for the plan, plus 5 extra × £90. Add one part-way through the year and you pay only for the months left.',
    );
  });
});

describe('proCost and recommendTier', () => {
  it('adds each worker beyond the allowance', () => {
    expect(proCost({ tier: 'growth', interval: 'month' }, 40)).toEqual({ planPence: 44900, extras: 5, extrasPence: 4500, totalPence: 49400 });
    expect(proCost({ tier: 'starter', interval: 'year' }, 8)).toEqual({ planPence: 149000, extras: 0, extrasPence: 0, totalPence: 149000 });
    expect(proCost({ tier: 'starter', interval: 'year' }, 11).totalPence).toBe(149000 + 12000);
  });

  it('recommends the cheapest tier, a tie going to the bigger plan', () => {
    expect(recommendTier(10, 'month').tier).toBe('starter');
    expect(recommendTier(35, 'month').tier).toBe('growth'); // 149 + 25 × 12 = 449 = growth
    expect(recommendTier(40, 'month').tier).toBe('growth');
    expect(recommendTier(80, 'month').tier).toBe('pro');
    expect(recommendTier(40, 'year').tier).toBe('growth');
    expect(recommendTier(0, 'month').tier).toBe('starter');
    expect(recommendTier(5000, 'month').tier).toBe('pro');
  });
});

const ALL_ENV = [...Object.values(PRO_PLAN_PRICE_ENV).flatMap((m) => Object.values(m)), ...Object.values(EXTRA_WORKER_PRICE_ENV).flatMap((m) => Object.values(m))];
const saved: Record<string, string | undefined> = {};

function setEnv(values: Record<string, string>) {
  for (const key of ALL_ENV) {
    if (!(key in saved)) saved[key] = process.env[key];
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    delete saved[key];
  }
});

describe('price ids', () => {
  it('throws naming the missing variable and returns null for extras', () => {
    setEnv({});
    expect(() => proPlanPriceId({ tier: 'starter', interval: 'year' })).toThrow(/Missing STRIPE_PRICE_STARTER_YEARLY/);
    expect(extraWorkerPriceIdFor('growth', 'year')).toBeNull();
  });

  it('maps a choice to a price id and back', () => {
    setEnv({
      STRIPE_PRICE_STARTER: 'p_s_m',
      STRIPE_PRICE_STARTER_YEARLY: 'p_s_y',
      STRIPE_PRICE_EXTRA_WORKER_STARTER: 'x_s_m',
      STRIPE_PRICE_EXTRA_WORKER_STARTER_YEARLY: 'x_s_y',
      STRIPE_PRICE_PRO_YEARLY: 'p_p_y',
    });
    expect(proPlanPriceId({ tier: 'starter', interval: 'year' })).toBe('p_s_y');
    expect(extraWorkerPriceIdFor('starter', 'month')).toBe('x_s_m');
    expect(proChoiceForPriceId('p_p_y')).toEqual({ tier: 'pro', interval: 'year' });
    expect(proChoiceForPriceId('p_s_m')).toEqual({ tier: 'starter', interval: 'month' });
    expect(proChoiceForPriceId('x_s_m')).toBeNull();
    expect(proChoiceForPriceId(null)).toBeNull();
    expect(extraWorkerChoiceForPriceId('x_s_y')).toEqual({ tier: 'starter', interval: 'year' });
    expect(isExtraWorkerPrice('x_s_m')).toBe(true);
    expect(isExtraWorkerPrice('p_s_m')).toBe(false);
  });

  it('lets the sync recognise yearly Pro plan prices', () => {
    setEnv({ STRIPE_PRICE_STARTER: 'p_s_m', STRIPE_PRICE_STARTER_YEARLY: 'p_s_y', STRIPE_PRICE_GROWTH_YEARLY: 'p_g_y' });
    expect(productsForPriceId('p_s_y')).toEqual(['starter']);
    expect(productsForPriceId('p_s_m')).toEqual(['starter']);
    expect(productsForPriceId('p_g_y')).toEqual(['growth']);
    expect(productsForPriceId('p_unknown')).toEqual([]);
  });
});
