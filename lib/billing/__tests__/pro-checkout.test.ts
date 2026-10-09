import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildProCheckoutBody } from '@/lib/billing/pro-checkout';

const ENV = {
  STRIPE_PRICE_GROWTH: 'price_growth_m',
  STRIPE_PRICE_GROWTH_YEARLY: 'price_growth_y',
  STRIPE_PRICE_STARTER: 'price_starter_m',
  STRIPE_PRICE_EXTRA_WORKER_GROWTH: 'price_extra_growth_m',
  STRIPE_PRICE_EXTRA_WORKER_GROWTH_YEARLY: 'price_extra_growth_y',
} as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
});
afterEach(() => {
  for (const k of Object.keys(ENV)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const base = { customerId: 'cus_1', intentId: 'intent_1', appUrl: 'http://localhost:3000' };

describe('buildProCheckoutBody', () => {
  it('charges the plan plus the extra workers already past the allowance', () => {
    const body = buildProCheckoutBody({ ...base, choice: { tier: 'growth', interval: 'month' }, workers: 40 });
    expect(body.line_items).toEqual([
      { price: 'price_growth_m', quantity: 1 },
      { price: 'price_extra_growth_m', quantity: 5 },
    ]);
    expect(body.subscription_data?.metadata).toMatchObject({ expected_workers: '40' });
  });

  it('has one line when the team fits inside the plan', () => {
    const body = buildProCheckoutBody({ ...base, choice: { tier: 'growth', interval: 'month' }, workers: 35 });
    expect(body.line_items).toEqual([{ price: 'price_growth_m', quantity: 1 }]);
    expect(body.subscription_data?.metadata).not.toHaveProperty('expected_workers');
  });

  it('uses the yearly price for a yearly plan', () => {
    const body = buildProCheckoutBody({ ...base, choice: { tier: 'growth', interval: 'year' } });
    expect(body.line_items).toEqual([{ price: 'price_growth_y', quantity: 1 }]);
  });

  it('never carries a discount, a trial or a promotion-code box', () => {
    const body = buildProCheckoutBody({ ...base, choice: { tier: 'growth', interval: 'month' } });
    expect('discounts' in body).toBe(false);
    expect(body.allow_promotion_codes).toBe(false);
    expect(JSON.stringify(body)).not.toContain('trial_period_days');
    expect(body.payment_method_collection).toBe('always');
    expect(body.mode).toBe('subscription');
  });

  it('records the intent, tier, interval and kind in the subscription metadata', () => {
    const body = buildProCheckoutBody({ ...base, choice: { tier: 'growth', interval: 'year' } });
    expect(body.client_reference_id).toBe('intent_1');
    expect(body.subscription_data?.metadata).toEqual({
      signup_intent_id: 'intent_1',
      tier: 'growth',
      interval: 'year',
      kind: 'pro_signup',
    });
  });

  it('sends people back to the Pro sign-up page with their choice if they cancel', () => {
    const body = buildProCheckoutBody({ ...base, choice: { tier: 'growth', interval: 'year' }, workers: 40 });
    expect(body.cancel_url).toBe('http://localhost:3000/signup/pro?tier=growth&interval=year&workers=40&canceled=1');
    expect(body.success_url).toBe('http://localhost:3000/signup/complete?session_id={CHECKOUT_SESSION_ID}');
    const noWorkers = buildProCheckoutBody({ ...base, choice: { tier: 'starter', interval: 'month' } });
    expect(noWorkers.cancel_url).toBe('http://localhost:3000/signup/pro?tier=starter&interval=month&canceled=1');
  });

  it('says plainly what is paid today', () => {
    const body = buildProCheckoutBody({ ...base, choice: { tier: 'growth', interval: 'year' } });
    const message = (body.custom_text?.submit as { message?: string } | undefined)?.message ?? '';
    expect(message).toContain('Growth: £4,490 a year');
    expect(message).toContain('past 35');
    expect(message).toContain('£90 each a year');
  });

  it('includes the extra workers in the checkout note when the team is already over', () => {
    const body = buildProCheckoutBody({ ...base, choice: { tier: 'growth', interval: 'month' }, workers: 40 });
    const message = (body.custom_text?.submit as { message?: string } | undefined)?.message ?? '';
    expect(message).toContain('Growth: £494 a month');
    expect(message).toContain('£449 plus 5 extra × £9');
  });

  it('throws naming the missing extra-worker price', () => {
    delete process.env.STRIPE_PRICE_EXTRA_WORKER_GROWTH;
    expect(() => buildProCheckoutBody({ ...base, choice: { tier: 'growth', interval: 'month' }, workers: 40 })).toThrow(
      /STRIPE_PRICE_EXTRA_WORKER_GROWTH/,
    );
  });

  it('throws naming the missing price variable', () => {
    delete process.env.STRIPE_PRICE_GROWTH_YEARLY;
    expect(() => buildProCheckoutBody({ ...base, choice: { tier: 'growth', interval: 'year' } })).toThrow(/STRIPE_PRICE_GROWTH_YEARLY/);
  });
});
