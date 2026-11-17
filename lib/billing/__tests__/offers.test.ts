import { beforeEach, describe, expect, it, vi } from 'vitest';

const lookupState = vi.hoisted(() => ({
  tenant: { id: 'ten-1', name: 'Acme', closed_at: null } as { id: string; name: string; closed_at: string | null } | null,
  subs: [] as { source: string; product: string; status: string }[],
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(table: string) {
      const api = {
        select: () => api,
        eq: () => api,
        is: () => api,
        maybeSingle: async () => ({ data: table === 'tenants' ? lookupState.tenant : null, error: null }),
        then(ok: (v: { data: unknown; error: unknown }) => unknown, bad?: (e: unknown) => unknown) {
          return Promise.resolve({ data: table === 'subscriptions' ? lookupState.subs : [], error: null }).then(ok, bad);
        },
      };
      return api;
    },
  }),
}));
import {
  chooseSignupOffer,
  founderCouponId,
  FOUNDING_PLACES,
  lookupReferrer,
  normaliseReferralCode,
  offerView,
  type FoundingStatus,
} from '@/lib/billing/offers';
import type { BillingInterval, PlanKey } from '@/lib/billing/plans';

const active: FoundingStatus = { active: true, placesLeft: 200, places: FOUNDING_PLACES };
const ended: FoundingStatus = { active: false, placesLeft: 0, places: FOUNDING_PLACES };
const unknown: FoundingStatus = { active: null, placesLeft: null, places: FOUNDING_PLACES };

function choice(plan: PlanKey, interval: BillingInterval) {
  return { plan, interval };
}

describe('normaliseReferralCode', () => {
  it('uppercases a valid code and rejects lookalike characters', () => {
    expect(normaliseReferralCode(' abcd2345 ')).toBe('ABCD2345');
    expect(normaliseReferralCode('abcd2345')).toBe('ABCD2345');
    expect(normaliseReferralCode('ABCD2340')).toBeNull();
    expect(normaliseReferralCode('ABCDO234')).toBeNull();
    expect(normaliseReferralCode('ABCD234')).toBeNull();
    expect(normaliseReferralCode(null)).toBeNull();
  });
});

describe("chooseSignupOffer: the founder coupon on Stripe's own page", () => {
  const fresh = { ...active, fresh: true };
  it('is shown on Checkout only when the count was just read and places are left', () => {
    expect(chooseSignupOffer({ choice: choice('rounds', 'month'), founding: fresh, referred: false }).couponAtCheckout).toBe(true);
    expect(chooseSignupOffer({ choice: choice('both', 'year'), founding: fresh, referred: true }).couponAtCheckout).toBe(true);
  });
  it('is not shown from the 10-minute cached count, when the count is unknown, or when places are gone', () => {
    expect(chooseSignupOffer({ choice: choice('rounds', 'month'), founding: active, referred: false }).couponAtCheckout).toBe(false);
    expect(chooseSignupOffer({ choice: choice('rounds', 'month'), founding: unknown, referred: false }).couponAtCheckout).toBe(false);
    expect(chooseSignupOffer({ choice: choice('rounds', 'month'), founding: { ...ended, fresh: true }, referred: false }).couponAtCheckout).toBe(false);
  });
});

describe('chooseSignupOffer', () => {
  it('gives everyone a 30-day trial, and 60 days to a referred friend', () => {
    for (const plan of ['rounds', 'lite', 'both'] as PlanKey[]) {
      for (const interval of ['month', 'year'] as BillingInterval[]) {
        expect(chooseSignupOffer({ choice: choice(plan, interval), founding: active, referred: false }).trialDays).toBe(30);
        expect(chooseSignupOffer({ choice: choice(plan, interval), founding: active, referred: true }).trialDays).toBe(60);
      }
    }
  });

  it('asks for a founder place while places last, or when the count is unknown, monthly and yearly', () => {
    for (const interval of ['month', 'year'] as BillingInterval[]) {
      for (const founding of [active, unknown]) {
        const offer = chooseSignupOffer({ choice: choice('rounds', interval), founding, referred: false });
        expect(offer).toMatchObject({ offer: 'founding', founder: true });
        expect(offerView(offer)).toBe('founder');
      }
      const gone = chooseSignupOffer({ choice: choice('rounds', interval), founding: ended, referred: false });
      expect(gone).toMatchObject({ offer: 'none', founder: false });
      expect(offerView(gone)).toBe('trial');
    }
  });

  it('keeps the referral in the offer view and the stored offer', () => {
    const both = chooseSignupOffer({ choice: choice('lite', 'month'), founding: active, referred: true });
    expect(offerView(both)).toBe('founder_referred');
    expect(both.offer).toBe('founding');
    const afterFounding = chooseSignupOffer({ choice: choice('lite', 'month'), founding: ended, referred: true });
    expect(afterFounding.offer).toBe('free_month');
    expect(offerView(afterFounding)).toBe('referred');
  });

  it('uses the plan prices in the headlines', () => {
    expect(chooseSignupOffer({ choice: choice('rounds', 'month'), founding: active, referred: false }).headline).toBe(
      '30 days free, then £17.50 a month for life (founder price). Cancel any time before then and you pay nothing.'
    );
    expect(chooseSignupOffer({ choice: choice('both', 'year'), founding: active, referred: true }).headline).toBe(
      '60 days free, then £295 a year for life (founder price). Cancel any time before then and you pay nothing.'
    );
    expect(chooseSignupOffer({ choice: choice('lite', 'month'), founding: ended, referred: false }).headline).toBe(
      '30 days free, then £35 a month. Cancel any time before then and you pay nothing.'
    );
  });
});

describe('founderCouponId', () => {
  it('reads the env var and throws when it is missing', () => {
    const previous = process.env.STRIPE_COUPON_FOUNDER;
    process.env.STRIPE_COUPON_FOUNDER = 'FOUNDER_50';
    expect(founderCouponId()).toBe('FOUNDER_50');
    delete process.env.STRIPE_COUPON_FOUNDER;
    expect(() => founderCouponId()).toThrow('Missing STRIPE_COUPON_FOUNDER');
    if (previous !== undefined) process.env.STRIPE_COUPON_FOUNDER = previous;
  });
});

describe('lookupReferrer', () => {
  beforeEach(() => {
    lookupState.tenant = { id: 'ten-1', name: 'Acme', closed_at: null };
    lookupState.subs = [];
  });
  const code = 'ABCD2345';
  const stripe = (product: string, status = 'active') => ({ source: 'stripe', product, status });

  it('accepts a Rounds or Lite business, as before', async () => {
    lookupState.subs = [stripe('rounds')];
    expect(await lookupReferrer(code)).toEqual({ tenantId: 'ten-1', businessName: 'Acme', code });
    lookupState.subs = [stripe('lite', 'trialing')];
    expect(await lookupReferrer(code)).not.toBeNull();
  });

  it.each(['starter', 'growth', 'pro'])('accepts a Stripe-billed %s business', async (tier) => {
    lookupState.subs = [stripe(tier)];
    expect(await lookupReferrer(code)).toEqual({ tenantId: 'ten-1', businessName: 'Acme', code });
  });

  it('never accepts a manual business, a Pro row that is not Stripe-billed, or an ended plan', async () => {
    lookupState.subs = [{ source: 'manual', product: 'pro', status: 'manual' }];
    expect(await lookupReferrer(code)).toBeNull();
    lookupState.subs = [stripe('starter'), { source: 'other', product: 'pro', status: 'active' }];
    expect(await lookupReferrer(code)).toBeNull();
    lookupState.subs = [stripe('starter', 'canceled')];
    expect(await lookupReferrer(code)).toBeNull();
    lookupState.subs = [{ source: 'manual', product: 'rounds', status: 'manual' }];
    expect(await lookupReferrer(code)).toBeNull();
  });

  it('is null for a bad code, no business, or a closed business', async () => {
    lookupState.subs = [stripe('starter')];
    expect(await lookupReferrer('nope')).toBeNull();
    lookupState.tenant = null;
    expect(await lookupReferrer(code)).toBeNull();
  });
});
