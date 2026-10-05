import 'server-only';
import type Stripe from 'stripe';
import { secondMonthCouponId } from '@/lib/billing/offers';
import { getStripe } from '@/lib/stripe/client';

export type SecondMonthResult = { result: 'not_applicable' | 'already_applied' | 'applied' };

/** Newer API versions nest the subscription under invoice.parent; older ones expose invoice.subscription. */
function subscriptionIdOf(invoice: Stripe.Invoice): string | null {
  const modern = (invoice as unknown as {
    parent?: { subscription_details?: { subscription?: string | { id: string } } };
  }).parent?.subscription_details?.subscription;
  const legacy = (invoice as unknown as { subscription?: string | { id: string } }).subscription;
  const ref = modern ?? legacy;
  if (!ref) return null;
  return typeof ref === 'string' ? ref : ref.id;
}

/**
 * Webhook hook for invoice.paid. A referred monthly sign-up during the founding offer gets month 1 free
 * (the 100% coupon at Checkout), then month 2 at half price, then full price. Checkout takes one coupon, so
 * once the free first invoice is settled we attach a one-time 50% coupon: it lands on the next invoice only.
 * Idempotent: a metadata flag plus a Stripe idempotency key. Throws only so Stripe retries.
 */
export async function onFirstInvoicePaid(invoice: Stripe.Invoice): Promise<SecondMonthResult> {
  if (invoice.billing_reason !== 'subscription_create') return { result: 'not_applicable' };
  const subscriptionId = subscriptionIdOf(invoice);
  if (!subscriptionId) return { result: 'not_applicable' };

  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  if (subscription.metadata?.second_month_half !== '1') return { result: 'not_applicable' };
  if (subscription.metadata?.second_month_half_applied === '1') return { result: 'already_applied' };
  // The free month did not come through (no 100% coupon on this invoice): don't hand out a half month on top.
  if (invoice.total !== 0) {
    console.error(`[second-month] first invoice was not free sub=${subscriptionId}`);
    return { result: 'not_applicable' };
  }

  const kept = (subscription.discounts ?? []).flatMap((entry) => (typeof entry === 'string' ? [{ discount: entry }] : [{ discount: entry.id }]));
  await stripe.subscriptions.update(
    subscriptionId,
    {
      discounts: [...kept, { coupon: secondMonthCouponId() }],
      metadata: { second_month_half_applied: '1' },
    },
    { idempotencyKey: `second-month-half-${subscriptionId}` }
  );
  return { result: 'applied' };
}
