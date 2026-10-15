import { describe, expect, it } from 'vitest';
import {
  billsNeeded,
  isFullProBill,
  monthlyListPence,
  paidValuePence,
  rewardPence,
  type ReferralSide,
} from '@/lib/billing/referral-reward';

const rounds: ReferralSide = { family: 'rounds_lite', plan: 'rounds' };
const lite: ReferralSide = { family: 'rounds_lite', plan: 'lite' };
const both: ReferralSide = { family: 'rounds_lite', plan: 'both' };
const starter: ReferralSide = { family: 'pro', tier: 'starter', interval: 'month' };
const growthYear: ReferralSide = { family: 'pro', tier: 'growth', interval: 'year' };
const growth: ReferralSide = { family: 'pro', tier: 'growth', interval: 'month' };
const pro: ReferralSide = { family: 'pro', tier: 'pro', interval: 'month' };

describe('monthlyListPence', () => {
  it('uses the monthly list price even for a yearly side', () => {
    expect(monthlyListPence(rounds)).toBe(3500);
    expect(monthlyListPence(both)).toBe(5900);
    expect(monthlyListPence(starter)).toBe(14900);
    expect(monthlyListPence(growthYear)).toBe(44900);
    expect(monthlyListPence(pro)).toBe(74900);
  });
});

describe('rewardPence', () => {
  it('Rounds/Lite pairs keep the Phase 7 rule: one month of the referrer\'s own plan', () => {
    expect(rewardPence({ referrer: rounds, referred: both })).toBe(3500);
    expect(rewardPence({ referrer: both, referred: rounds })).toBe(5900);
    expect(rewardPence({ referrer: lite, referred: lite })).toBe(3500);
  });

  it('is the cheaper of the two when either side is Pro', () => {
    expect(rewardPence({ referrer: rounds, referred: growth })).toBe(3500);
    expect(rewardPence({ referrer: starter, referred: rounds })).toBe(3500);
    expect(rewardPence({ referrer: starter, referred: growth })).toBe(14900);
    expect(rewardPence({ referrer: pro, referred: starter })).toBe(14900);
    expect(rewardPence({ referrer: both, referred: rounds })).toBe(5900);
    expect(rewardPence({ referrer: rounds, referred: growthYear })).toBe(3500);
    expect(rewardPence({ referrer: starter, referred: growthYear })).toBe(14900);
  });

  it('is always a positive whole number', () => {
    const sides = [rounds, lite, both, starter, growth, growthYear, pro];
    for (const referrer of sides) {
      for (const referred of sides) {
        const pence = rewardPence({ referrer, referred });
        expect(Number.isInteger(pence) && pence > 0).toBe(true);
      }
    }
  });
});

describe('billsNeeded', () => {
  it('is 1 for Rounds/Lite, 3 for Pro monthly and 1 for Pro yearly', () => {
    expect(billsNeeded(rounds)).toBe(1);
    expect(billsNeeded(both)).toBe(1);
    expect(billsNeeded(starter)).toBe(3);
    expect(billsNeeded(growthYear)).toBe(1);
  });
});

describe('isFullProBill', () => {
  const bill = (over: Partial<Parameters<typeof isFullProBill>[0]> = {}) => ({
    status: 'paid',
    billing_reason: 'subscription_cycle',
    subtotal: 14900,
    total_discount_amounts: null,
    ...over,
  });
  const month = { family: 'pro', tier: 'starter', interval: 'month' } as const;
  const year = { family: 'pro', tier: 'starter', interval: 'year' } as const;

  it('counts the first payment and renewals at the full price', () => {
    expect(isFullProBill(bill({ billing_reason: 'subscription_create' }), month)).toBe(true);
    expect(isFullProBill(bill(), month)).toBe(true);
  });

  it('does not count a mid-cycle change, an unpaid invoice or other reasons', () => {
    expect(isFullProBill(bill({ billing_reason: 'subscription_update' }), month)).toBe(false);
    expect(isFullProBill(bill({ billing_reason: 'manual' }), month)).toBe(false);
    expect(isFullProBill(bill({ billing_reason: null }), month)).toBe(false);
    expect(isFullProBill(bill({ status: 'open' }), month)).toBe(false);
    expect(isFullProBill(bill({ status: null }), month)).toBe(false);
  });

  it('does not count a partial payment or a discounted one', () => {
    expect(isFullProBill(bill({ subtotal: 14800 }), month)).toBe(false);
    expect(isFullProBill(bill({ total_discount_amounts: [{ amount: 100 }] }), month)).toBe(false);
  });

  it('uses the yearly price for a yearly plan', () => {
    expect(isFullProBill(bill({ subtotal: 14900 }), year)).toBe(false);
    expect(isFullProBill(bill({ subtotal: 149000 }), year)).toBe(true);
  });

  it('does not need extras to reach the price, and more than the price still counts', () => {
    expect(isFullProBill(bill({ subtotal: 14900 + 3600 }), month)).toBe(true);
  });
});

describe('paidValuePence', () => {
  it('subtracts discounts', () => {
    expect(paidValuePence({ subtotal: 3500, total_discount_amounts: [{ amount: 1750 }] })).toBe(1750);
    expect(paidValuePence({ subtotal: 3500 })).toBe(3500);
  });
});
