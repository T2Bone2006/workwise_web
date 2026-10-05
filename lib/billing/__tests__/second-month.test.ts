import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

const { stripe, getStripe } = vi.hoisted(() => {
  const stripe = { subscriptions: { retrieve: vi.fn(), update: vi.fn() } };
  return { stripe, getStripe: vi.fn(() => stripe) };
});
vi.mock('@/lib/stripe/client', () => ({ getStripe }));

import { onFirstInvoicePaid } from '@/lib/billing/second-month';

function invoice(overrides: Record<string, unknown> = {}): Stripe.Invoice {
  return {
    id: 'in_1',
    billing_reason: 'subscription_create',
    total: 0,
    parent: { subscription_details: { subscription: 'sub_1' } },
    ...overrides,
  } as unknown as Stripe.Invoice;
}

function sub(metadata: Record<string, string>, discounts: unknown[] = []) {
  return { id: 'sub_1', metadata, discounts };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_COUPON_REFERRAL_SECOND_HALF = 'coupon_half';
  stripe.subscriptions.update.mockResolvedValue({});
});

describe('onFirstInvoicePaid', () => {
  it('adds the one-time half-price coupon and marks the subscription', async () => {
    stripe.subscriptions.retrieve.mockResolvedValue(sub({ second_month_half: '1' }));
    await expect(onFirstInvoicePaid(invoice())).resolves.toEqual({ result: 'applied' });
    expect(stripe.subscriptions.update).toHaveBeenCalledWith(
      'sub_1',
      { discounts: [{ coupon: 'coupon_half' }], metadata: { second_month_half_applied: '1' } },
      { idempotencyKey: 'second-month-half-sub_1' }
    );
  });

  it('keeps a discount that is still on the subscription', async () => {
    stripe.subscriptions.retrieve.mockResolvedValue(sub({ second_month_half: '1' }, [{ id: 'di_keep' }]));
    await onFirstInvoicePaid(invoice());
    expect(stripe.subscriptions.update.mock.calls[0][1].discounts).toEqual([
      { discount: 'di_keep' },
      { coupon: 'coupon_half' },
    ]);
  });

  it('does nothing twice', async () => {
    stripe.subscriptions.retrieve.mockResolvedValue(
      sub({ second_month_half: '1', second_month_half_applied: '1' })
    );
    await expect(onFirstInvoicePaid(invoice())).resolves.toEqual({ result: 'already_applied' });
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it('ignores renewals, other subscriptions and a first invoice that was not free', async () => {
    await expect(onFirstInvoicePaid(invoice({ billing_reason: 'subscription_cycle' }))).resolves.toEqual({
      result: 'not_applicable',
    });
    stripe.subscriptions.retrieve.mockResolvedValue(sub({}));
    await expect(onFirstInvoicePaid(invoice())).resolves.toEqual({ result: 'not_applicable' });
    stripe.subscriptions.retrieve.mockResolvedValue(sub({ second_month_half: '1' }));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(onFirstInvoicePaid(invoice({ total: 1750 }))).resolves.toEqual({ result: 'not_applicable' });
    spy.mockRestore();
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it('throws when the coupon is not configured so Stripe retries', async () => {
    delete process.env.STRIPE_COUPON_REFERRAL_SECOND_HALF;
    stripe.subscriptions.retrieve.mockResolvedValue(sub({ second_month_half: '1' }));
    await expect(onFirstInvoicePaid(invoice())).rejects.toThrow('Missing STRIPE_COUPON_REFERRAL_SECOND_HALF');
  });
});
