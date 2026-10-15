import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import {
  paymentRowFromCheckoutSession,
  refundedAmountFromCharge,
} from '@/lib/stripe/connect-events';

const TENANT = '11111111-1111-4111-8111-111111111111';
const CUSTOMER = '22222222-2222-4222-8222-222222222222';
const CREATED = 1_700_000_000;

function session(
  overrides: Partial<Stripe.Checkout.Session> = {},
): Stripe.Checkout.Session {
  return {
    id: 'cs_test_1',
    payment_status: 'paid',
    currency: 'gbp',
    amount_total: 1500,
    payment_intent: 'pi_test_1',
    metadata: {
      workwise_kind: 'pay_link',
      workwise_tenant_id: TENANT,
      customer_id: CUSTOMER,
      invoice_id: '',
    },
    ...overrides,
  } as Stripe.Checkout.Session;
}

describe('paymentRowFromCheckoutSession', () => {
  it('ignores a session that is not a pay link', () => {
    const result = paymentRowFromCheckoutSession(
      session({ metadata: { workwise_kind: 'subscription' } }),
      TENANT,
      CREATED,
    );
    expect(result).toEqual({ ok: false, reason: 'not_ours' });
  });

  it('ignores an unpaid session', () => {
    const result = paymentRowFromCheckoutSession(
      session({ payment_status: 'unpaid' }),
      TENANT,
      CREATED,
    );
    expect(result).toEqual({ ok: false, reason: 'not_paid' });
  });

  it('ignores a non-GBP session', () => {
    const result = paymentRowFromCheckoutSession(
      session({ currency: 'usd' }),
      TENANT,
      CREATED,
    );
    expect(result).toEqual({ ok: false, reason: 'wrong_currency' });
  });

  it('ignores a tenant mismatch', () => {
    const result = paymentRowFromCheckoutSession(
      session(),
      '33333333-3333-4333-8333-333333333333',
      CREATED,
    );
    expect(result).toEqual({ ok: false, reason: 'tenant_mismatch' });
  });

  it('maps pence to pounds and event.created to ISO', () => {
    const result = paymentRowFromCheckoutSession(session(), TENANT, CREATED);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.row.amount).toBe(15);
    expect(result.row.received_at).toBe(new Date(CREATED * 1000).toISOString());
    expect(result.row.method).toBe('card');
    expect(result.row.source).toBe('stripe');
    expect(result.row.stripe_payment_intent_id).toBe('pi_test_1');
    expect(result.row.invoice_id).toBeNull();
    expect(result.row.note).toBe('Card payment');
  });
});

describe('refundedAmountFromCharge', () => {
  it('caps the refund at the payment amount', () => {
    expect(
      refundedAmountFromCharge({ amount: 1500, amount_refunded: 5000 }, 15),
    ).toBe(15);
    expect(
      refundedAmountFromCharge({ amount: 1500, amount_refunded: 500 }, 15),
    ).toBe(5);
  });
});
