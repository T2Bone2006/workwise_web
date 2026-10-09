import { describe, expect, it } from 'vitest';
import { endedProChoice, isPaymentOverdue, proRestartLines, proRestartSummary } from '@/lib/billing/pro-restart-core';

describe('proRestartLines', () => {
  const base = { planPriceId: 'price_plan', extraPriceId: 'price_extra', included: 10 };

  it('is one line when the team fits the plan', () => {
    expect(proRestartLines({ ...base, teamSize: 10 })).toEqual([{ price: 'price_plan', quantity: 1 }]);
    expect(proRestartLines({ ...base, teamSize: 0 })).toEqual([{ price: 'price_plan', quantity: 1 }]);
  });

  it('adds the extras line for each worker over the allowance', () => {
    expect(proRestartLines({ ...base, teamSize: 13 })).toEqual([
      { price: 'price_plan', quantity: 1 },
      { price: 'price_extra', quantity: 3 },
    ]);
  });

  it('never adds a line without an extra price id', () => {
    expect(proRestartLines({ ...base, extraPriceId: null, teamSize: 13 })).toHaveLength(1);
  });
});

describe('isPaymentOverdue', () => {
  const stripe = (product: string, status: string) => ({ source: 'stripe', product, status });

  it('is true for a Stripe Pro that is past_due', () => {
    expect(isPaymentOverdue([stripe('starter', 'past_due')], true)).toBe(true);
    expect(isPaymentOverdue([stripe('pro', 'past_due')], true)).toBe(true);
  });

  it('is true for Rounds and Lite past_due, as before', () => {
    expect(isPaymentOverdue([stripe('rounds', 'past_due')], true)).toBe(true);
    expect(isPaymentOverdue([stripe('lite', 'past_due')], true)).toBe(true);
  });

  it('is false for a manual row anywhere (RS Locksmiths, Eden)', () => {
    expect(isPaymentOverdue([{ source: 'manual', product: 'pro', status: 'manual' }], true)).toBe(false);
    expect(isPaymentOverdue([stripe('starter', 'past_due'), { source: 'manual', product: 'pro', status: 'manual' }], true)).toBe(false);
  });

  it('is false when nothing is past_due, there is no customer, or the read failed', () => {
    expect(isPaymentOverdue([stripe('starter', 'active')], true)).toBe(false);
    expect(isPaymentOverdue([stripe('starter', 'past_due')], false)).toBe(false);
    expect(isPaymentOverdue(null, true)).toBe(false);
  });
});

describe('endedProChoice', () => {
  const ended = (product: string, interval: string | null = 'month') => ({
    source: 'stripe',
    product,
    status: 'canceled',
    billing_interval: interval,
  });

  it('returns the latest ended Pro tier and interval', () => {
    expect(endedProChoice([ended('starter', 'year')], true)).toEqual({ tier: 'starter', interval: 'year' });
    expect(endedProChoice([ended('growth'), ended('starter', 'year')], true)).toEqual({ tier: 'growth', interval: 'month' });
  });

  it('falls back to monthly when the interval is missing', () => {
    expect(endedProChoice([ended('pro', null)], true)?.interval).toBe('month');
  });

  it('is null for manual rows, no customer, no rows, a live plan, or a Rounds/Lite-only history', () => {
    expect(endedProChoice([{ source: 'manual', product: 'pro', status: 'manual' }], true)).toBeNull();
    expect(endedProChoice([ended('starter')], false)).toBeNull();
    expect(endedProChoice([], true)).toBeNull();
    expect(endedProChoice([ended('starter'), { source: 'stripe', product: 'growth', status: 'active' }], true)).toBeNull();
    expect(endedProChoice([ended('rounds'), ended('lite')], true)).toBeNull();
  });

  it('finds the Pro row in a mixed history', () => {
    expect(endedProChoice([ended('rounds'), ended('growth', 'year')], true)).toEqual({ tier: 'growth', interval: 'year' });
  });
});

describe('proRestartSummary', () => {
  it('is null when the team fits', () => {
    expect(proRestartSummary({ tier: 'starter', interval: 'month' }, 10)).toBeNull();
  });

  it('adds up plan and extras, monthly and yearly', () => {
    expect(proRestartSummary({ tier: 'starter', interval: 'month' }, 13)).toBe(
      'Starter: £149 + 3 extra workers £36 = £185 a month',
    );
    expect(proRestartSummary({ tier: 'growth', interval: 'year' }, 36)).toBe(
      'Growth: £4,490 + 1 extra worker £90 = £4,580 a year',
    );
  });
});
