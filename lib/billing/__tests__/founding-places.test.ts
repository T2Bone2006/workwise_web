import { beforeEach, describe, expect, it, vi } from 'vitest';

const { stripe, getStripe } = vi.hoisted(() => {
  const stripe = { coupons: { retrieve: vi.fn() } };
  return { stripe, getStripe: vi.fn(() => stripe) };
});
vi.mock('@/lib/stripe/client', () => ({ getStripe }));
vi.mock('next/cache', () => ({ unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));

import { getFoundingStatus } from '@/lib/billing/offers';

function coupons(map: Record<string, { max_redemptions: number | null; times_redeemed: number }>) {
  stripe.coupons.retrieve.mockImplementation(async (id: string) => map[id]);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_COUPON_FOUNDING = 'FOUNDING50';
  process.env.STRIPE_COUPON_REFERRAL_SECOND_HALF = 'HALF';
});

describe('getFoundingStatus', () => {
  it('counts a referred friend as a founding place', async () => {
    coupons({ FOUNDING50: { max_redemptions: 200, times_redeemed: 150 }, HALF: { max_redemptions: null, times_redeemed: 20 } });
    await expect(getFoundingStatus()).resolves.toEqual({ active: true, placesLeft: 30, places: 200 });
  });

  it('closes the offer when the two together fill the places', async () => {
    coupons({ FOUNDING50: { max_redemptions: 200, times_redeemed: 190 }, HALF: { max_redemptions: null, times_redeemed: 12 } });
    await expect(getFoundingStatus()).resolves.toEqual({ active: false, placesLeft: 0, places: 200 });
  });

  it('works before the half-price coupon is set up', async () => {
    delete process.env.STRIPE_COUPON_REFERRAL_SECOND_HALF;
    coupons({ FOUNDING50: { max_redemptions: 200, times_redeemed: 3 } });
    await expect(getFoundingStatus()).resolves.toEqual({ active: true, placesLeft: 197, places: 200 });
  });
});
