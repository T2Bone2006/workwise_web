import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

const { stripe, rpc, tenantRow } = vi.hoisted(() => ({
  stripe: { subscriptions: { retrieve: vi.fn(), update: vi.fn() }, invoices: { list: vi.fn() } },
  rpc: vi.fn(),
  tenantRow: { value: { id: 'ten_1' } as { id: string } | null },
}));
vi.mock('@/lib/stripe/client', () => ({ getStripe: () => stripe }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: tenantRow.value, error: null }) }) }) }),
  }),
}));

import { claimFounderPlace, releaseFounderPlaceIfTrialEnded } from '@/lib/billing/founder-place';

function sub(over: Record<string, unknown> = {}) {
  return { id: 'sub_1', metadata: { founder_requested: '1' }, discounts: [], ...over } as unknown as Stripe.Subscription;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_COUPON_FOUNDER = 'FOUNDER_50';
  tenantRow.value = { id: 'ten_1' };
});

describe('claimFounderPlace', () => {
  it('does nothing when the sign-up did not ask for a place', async () => {
    stripe.subscriptions.retrieve.mockResolvedValue(sub({ metadata: { founder_requested: '0' } }));
    await expect(claimFounderPlace({ subscriptionId: 'sub_1', tenantId: 'ten_1' })).resolves.toEqual({ result: 'not_requested' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('claims a place in the database, then attaches the coupon and marks the subscription', async () => {
    stripe.subscriptions.retrieve.mockResolvedValue(sub());
    rpc.mockResolvedValue({ data: 'claimed', error: null });
    await expect(claimFounderPlace({ subscriptionId: 'sub_1', tenantId: 'ten_1' })).resolves.toEqual({ result: 'claimed' });
    expect(rpc).toHaveBeenCalledWith('claim_founder_place', { p_tenant_id: 'ten_1', p_subscription_id: 'sub_1', p_limit: 200 });
    expect(stripe.subscriptions.update).toHaveBeenCalledWith(
      'sub_1',
      { discounts: [{ coupon: 'FOUNDER_50' }], metadata: { founder_place: '1' } },
      { idempotencyKey: 'founder-place-sub_1' },
    );
  });

  it('keeps an existing discount and does not add the coupon twice on a retry', async () => {
    stripe.subscriptions.retrieve.mockResolvedValue(
      sub({ discounts: [{ id: 'di_1', source: { coupon: { id: 'FOUNDER_50' } } }, { id: 'di_2', source: { coupon: 'OTHER' } }] }),
    );
    rpc.mockResolvedValue({ data: 'already', error: null });
    await claimFounderPlace({ subscriptionId: 'sub_1', tenantId: 'ten_1' });
    expect(stripe.subscriptions.update.mock.calls[0][1].discounts).toEqual([{ discount: 'di_1' }, { discount: 'di_2' }]);
  });

  it('puts no coupon on when all 200 places are taken, and says so on the subscription', async () => {
    stripe.subscriptions.retrieve.mockResolvedValue(sub());
    rpc.mockResolvedValue({ data: 'full', error: null });
    await expect(claimFounderPlace({ subscriptionId: 'sub_1', tenantId: 'ten_1' })).resolves.toEqual({ result: 'full' });
    expect(stripe.subscriptions.update.mock.calls[0][1]).toEqual({ metadata: { founder_place: '0' } });
  });

  it('does not decide twice', async () => {
    stripe.subscriptions.retrieve.mockResolvedValue(sub({ metadata: { founder_requested: '1', founder_place: '1' } }));
    await expect(claimFounderPlace({ subscriptionId: 'sub_1', tenantId: 'ten_1' })).resolves.toEqual({ result: 'already_decided' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('throws (so Stripe retries) when the database call fails, and attaches nothing', async () => {
    stripe.subscriptions.retrieve.mockResolvedValue(sub());
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(claimFounderPlace({ subscriptionId: 'sub_1', tenantId: 'ten_1' })).rejects.toThrow();
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });
});

describe('releaseFounderPlaceIfTrialEnded', () => {
  const base = { metadata: { founder_place: '1' }, customer: 'cus_1', trial_end: 2_000_000 };

  it('gives the place back when it is cancelled during the trial', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(releaseFounderPlaceIfTrialEnded(sub({ ...base, canceled_at: 1_900_000 }))).resolves.toBe('released');
    expect(rpc).toHaveBeenCalledWith('release_founder_place', { p_tenant_id: 'ten_1', p_reason: 'cancelled_in_trial' });
  });

  it('gives the place back when the trial ends with no card to charge', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(releaseFounderPlaceIfTrialEnded(sub({ ...base, canceled_at: 2_000_010 }))).resolves.toBe('released');
  });

  it('keeps the place when the business has paid and leaves later', async () => {
    stripe.invoices.list.mockResolvedValue({ data: [{ amount_paid: 1750 }] });
    await expect(releaseFounderPlaceIfTrialEnded(sub({ ...base, canceled_at: 9_000_000 }))).resolves.toBe('kept');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('gives the place back when the first charge failed and the subscription was cancelled after the retries', async () => {
    stripe.invoices.list.mockResolvedValue({ data: [{ amount_paid: 0 }] });
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(releaseFounderPlaceIfTrialEnded(sub({ ...base, canceled_at: 9_000_000 }))).resolves.toBe('released');
    expect(rpc).toHaveBeenCalledWith('release_founder_place', { p_tenant_id: 'ten_1', p_reason: 'ended_unpaid' });
  });

  it('throws (so Stripe retries) when it cannot check whether anything was paid, and releases nothing', async () => {
    stripe.invoices.list.mockRejectedValue(new Error('stripe down'));
    await expect(releaseFounderPlaceIfTrialEnded(sub({ ...base, canceled_at: 9_000_000 }))).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('ignores a subscription that never held a place', async () => {
    await expect(releaseFounderPlaceIfTrialEnded(sub({ ...base, metadata: {}, canceled_at: 1_900_000 }))).resolves.toBe('none');
  });
});
