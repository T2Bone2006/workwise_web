import 'server-only';
import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripe } from '@/lib/stripe/client';
import { founderCouponId, FOUNDING_PLACES } from '@/lib/billing/offers';

/** Set on the subscription once we have decided: '1' = holds a founder place (coupon attached), '0' = none left. */
export const FOUNDER_PLACE_META = 'founder_place';

export type FounderClaimResult =
  | { result: 'not_requested' | 'already_decided' | 'full' | 'used' }
  | { result: 'claimed' };

function discountSourceCoupon(entry: Stripe.Discount | string): string | null {
  if (typeof entry === 'string') return null;
  const coupon = entry.source?.coupon;
  if (!coupon) return null;
  return typeof coupon === 'string' ? coupon : coupon.id;
}

/**
 * Webhook hook, after the business exists. If this sign-up asked for a founder place, claim one in the database
 * (atomic: two people finishing at the same moment take turns, place 201 is never given out) and only then attach
 * the 50%-for-life coupon to the subscription. Safe to run again: a place already held is not claimed twice and the
 * coupon is not added twice. Throws only so Stripe retries; a "full" answer is a normal result, not an error.
 */
export async function claimFounderPlace(input: { subscriptionId: string; tenantId: string }): Promise<FounderClaimResult> {
  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(input.subscriptionId);
  if (subscription.metadata?.founder_requested !== '1') return { result: 'not_requested' };
  if (subscription.metadata?.[FOUNDER_PLACE_META] === '1') return { result: 'already_decided' };
  if (subscription.metadata?.[FOUNDER_PLACE_META] === '0') return { result: 'already_decided' };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('claim_founder_place', {
    p_tenant_id: input.tenantId,
    p_subscription_id: input.subscriptionId,
    p_limit: FOUNDING_PLACES,
  });
  if (error || typeof data !== 'string') throw new Error('claim_founder_place failed');

  if (data === 'full' || data === 'used') {
    await stripe.subscriptions.update(
      input.subscriptionId,
      { metadata: { [FOUNDER_PLACE_META]: '0' } },
      { idempotencyKey: `founder-none-${input.subscriptionId}` },
    );
    console.warn(`[founder] no place sub=${input.subscriptionId} reason=${data}`);
    return { result: data };
  }

  // 'claimed' or 'already' (a retry after the coupon step failed): make sure the coupon is on.
  const couponId = founderCouponId();
  const entries = subscription.discounts ?? [];
  const hasCoupon = entries.some((entry) => discountSourceCoupon(entry) === couponId);
  const kept = entries.flatMap((entry) => (typeof entry === 'string' ? [{ discount: entry }] : [{ discount: entry.id }]));
  await stripe.subscriptions.update(
    input.subscriptionId,
    {
      discounts: hasCoupon ? kept : [...kept, { coupon: couponId }],
      metadata: { [FOUNDER_PLACE_META]: '1' },
    },
    { idempotencyKey: `founder-place-${input.subscriptionId}` },
  );
  return { result: 'claimed' };
}

/**
 * Webhook hook for customer.subscription.deleted. A place goes back to the pool when the subscription ends
 * during the free trial (cancelled by the customer, or the trial ended with no card). A business that has already
 * paid a bill keeps its place used (one whose first charge never succeeded gives it back), so the first 200 stay the first 200. Never throws for "nothing to do".
 */
export async function releaseFounderPlaceIfTrialEnded(subscription: Stripe.Subscription): Promise<'released' | 'kept' | 'none'> {
  if (subscription.metadata?.[FOUNDER_PLACE_META] !== '1') return 'none';
  const trialEnd = subscription.trial_end;
  const endedAt = subscription.canceled_at ?? subscription.ended_at;
  if (!trialEnd || !endedAt) return 'kept';
  // Cancelled before the trial ran out, or cancelled by Stripe at the end of it because no card could be charged.
  let reason = 'cancelled_in_trial';
  if (endedAt > trialEnd + 3600) {
    // Ended later. A business that has paid a bill keeps its place used. One that never paid anything (the first
    // charge failed and Stripe gave up after its retries) gives the place back, or it would be lost for good.
    // Throws on a Stripe error so the webhook retries instead of guessing.
    const paid = await getStripe().invoices.list({ subscription: subscription.id, status: 'paid', limit: 20 });
    if (paid.data.some((invoice) => (invoice.amount_paid ?? 0) > 0)) return 'kept';
    reason = 'ended_unpaid';
  }

  const customer = subscription.customer;
  const customerId = typeof customer === 'string' ? customer : customer?.id;
  if (!customerId) return 'kept';
  const admin = createAdminClient();
  const { data: tenant, error: tenantError } = await admin
    .from('tenants')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  if (tenantError) throw new Error('founder release: tenant lookup failed');
  if (!tenant?.id) return 'none';

  const { data, error } = await admin.rpc('release_founder_place', {
    p_tenant_id: tenant.id,
    p_reason: reason,
  });
  if (error) throw new Error('release_founder_place failed');
  return data === true ? 'released' : 'none';
}
