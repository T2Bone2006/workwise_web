import { describe, expect, it } from 'vitest';
import { buildUpgradeItems, overAfterUpgrade } from '@/lib/billing/pro-manage-core';
import { classifyProChange } from '@/lib/billing/pro-plans';

describe('classifyProChange', () => {
  it('lets a higher tier on the same interval go up now', () => {
    expect(classifyProChange({ tier: 'starter', interval: 'month' }, { tier: 'growth', interval: 'month' })).toBe('up_now');
    expect(classifyProChange({ tier: 'growth', interval: 'year' }, { tier: 'pro', interval: 'year' })).toBe('up_now');
    expect(classifyProChange({ tier: 'starter', interval: 'month' }, { tier: 'pro', interval: 'month' })).toBe('up_now');
  });

  it('same is same; lower tiers and interval switches go through us', () => {
    expect(classifyProChange({ tier: 'growth', interval: 'month' }, { tier: 'growth', interval: 'month' })).toBe('same');
    expect(classifyProChange({ tier: 'growth', interval: 'month' }, { tier: 'starter', interval: 'month' })).toBe('not_offered');
    expect(classifyProChange({ tier: 'starter', interval: 'month' }, { tier: 'starter', interval: 'year' })).toBe('not_offered');
    expect(classifyProChange({ tier: 'starter', interval: 'month' }, { tier: 'growth', interval: 'year' })).toBe('not_offered');
  });
});

describe('overAfterUpgrade', () => {
  it('is the workers over the new allowance, never negative', () => {
    expect(overAfterUpgrade(20, 35)).toBe(0);
    expect(overAfterUpgrade(40, 35)).toBe(5);
    expect(overAfterUpgrade(35, 35)).toBe(0);
    expect(overAfterUpgrade(0, 35)).toBe(0);
  });
});

describe('buildUpgradeItems', () => {
  it('swaps the plan line price and quantity-shrinks the extra line', () => {
    expect(
      buildUpgradeItems({ planItemId: 'si_plan', extraItemId: 'si_extra', targetPlanPriceId: 'price_growth', targetExtraPriceId: 'price_extra_growth', newOver: 5 }),
    ).toEqual([
      { id: 'si_plan', price: 'price_growth' },
      { id: 'si_extra', price: 'price_extra_growth', quantity: 5 },
    ]);
  });

  it('removes the extra line when nobody is over the new allowance', () => {
    expect(buildUpgradeItems({ planItemId: 'si_plan', extraItemId: 'si_extra', targetPlanPriceId: 'price_growth', targetExtraPriceId: null, newOver: 0 })).toEqual([
      { id: 'si_plan', price: 'price_growth' },
      { id: 'si_extra', deleted: true },
    ]);
  });

  it('is just the plan swap when there was no extra line and none is needed', () => {
    expect(buildUpgradeItems({ planItemId: 'si_plan', extraItemId: null, targetPlanPriceId: 'price_pro', targetExtraPriceId: null, newOver: 0 })).toEqual([
      { id: 'si_plan', price: 'price_pro' },
    ]);
  });

  it('adds an extra line when there was none but the team is over the new allowance', () => {
    expect(buildUpgradeItems({ planItemId: 'si_plan', extraItemId: null, targetPlanPriceId: 'price_growth', targetExtraPriceId: 'price_extra_growth', newOver: 2 })).toEqual([
      { id: 'si_plan', price: 'price_growth' },
      { price: 'price_extra_growth', quantity: 2 },
    ]);
  });

  it('refuses to guess a price when extras are needed but the price is missing', () => {
    expect(() => buildUpgradeItems({ planItemId: 'a', extraItemId: null, targetPlanPriceId: 'p', targetExtraPriceId: null, newOver: 3 })).toThrow();
  });
});
