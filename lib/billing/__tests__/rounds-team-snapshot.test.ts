import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/stripe/client', () => ({ getStripe: () => ({}) }));

import { snapshotSubscription } from '@/lib/stripe/sync-subscription';

function subscription(items: Array<{ price: string; quantity: number }>): Stripe.Subscription {
  return {
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    trial_end: null,
    cancel_at_period_end: false,
    canceled_at: null,
    items: {
      data: items.map((i, n) => ({ id: `si_${n}`, price: { id: i.price }, quantity: i.quantity, current_period_end: 1_800_000_000 })),
    },
  } as unknown as Stripe.Subscription;
}

beforeEach(() => {
  process.env.STRIPE_PRICE_ROUNDS = 'price_rounds_m';
  process.env.STRIPE_PRICE_ROUNDS_TEAM_MONTHLY = 'price_team_m';
});

describe('snapshotSubscription with a Rounds team line', () => {
  it('reads the plan from the plan line and seats from it, not from the team line', () => {
    const snap = snapshotSubscription(
      subscription([
        { price: 'price_team_m', quantity: 3 },
        { price: 'price_rounds_m', quantity: 1 },
      ]),
    );
    expect(snap.stripePriceId).toBe('price_rounds_m');
    expect(snap.products).toEqual(['rounds']);
    expect(snap.choice).toEqual({ plan: 'rounds', interval: 'month' });
    expect(snap.seats).toBe(1);
  });

  it('gives the same answer when the plan line is first', () => {
    const snap = snapshotSubscription(
      subscription([
        { price: 'price_rounds_m', quantity: 1 },
        { price: 'price_team_m', quantity: 3 },
      ]),
    );
    expect(snap.choice).toEqual({ plan: 'rounds', interval: 'month' });
    expect(snap.seats).toBe(1);
  });
});
