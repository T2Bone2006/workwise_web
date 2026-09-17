import 'server-only';
import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { productForPriceId } from '@/lib/stripe/products';

/** Stripe's status vocabulary is stored as-is; see the CHECK on subscriptions.status. */
const KNOWN_STATUSES = new Set([
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'paused',
]);

function toIso(unixSeconds: number | null | undefined): string | null {
  return unixSeconds ? new Date(unixSeconds * 1000).toISOString() : null;
}

/**
 * Newer Stripe API versions moved current_period_end onto the subscription
 * items; older ones keep it on the subscription. Read whichever exists.
 */
function currentPeriodEnd(subscription: Stripe.Subscription): string | null {
  const item = subscription.items?.data?.[0] as { current_period_end?: number } | undefined;
  const legacy = (subscription as unknown as { current_period_end?: number }).current_period_end;
  return toIso(item?.current_period_end ?? legacy);
}

export type SubscriptionSnapshot = {
  stripeSubscriptionId: string;
  stripeCustomerId: string | null;
  stripePriceId: string | null;
  product: ReturnType<typeof productForPriceId>;
  status: string;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  seats: number;
};

export function snapshotSubscription(subscription: Stripe.Subscription): SubscriptionSnapshot {
  const item = subscription.items?.data?.[0];
  const priceId = item?.price?.id ?? null;
  const customer = subscription.customer;
  return {
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: typeof customer === 'string' ? customer : customer?.id ?? null,
    stripePriceId: priceId,
    product: productForPriceId(priceId),
    status: KNOWN_STATUSES.has(subscription.status) ? subscription.status : 'incomplete',
    trialEndsAt: toIso(subscription.trial_end),
    currentPeriodEnd: currentPeriodEnd(subscription),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    canceledAt: toIso(subscription.canceled_at),
    seats: item?.quantity ?? 1,
  };
}

/**
 * Upserts the subscriptions row for a Stripe subscription. Used for every
 * subscription lifecycle event after provisioning (updated, deleted, payment
 * failed). Returns false if the price isn't one of ours.
 */
export async function syncSubscription(subscription: Stripe.Subscription): Promise<boolean> {
  const snap = snapshotSubscription(subscription);
  if (!snap.product) {
    console.warn(`[syncSubscription] unknown price ${snap.stripePriceId} on ${subscription.id}; ignoring`);
    return false;
  }

  const admin = createAdminClient();

  // Find the tenant: existing row for this subscription, else by customer id.
  const { data: existing } = await admin
    .from('subscriptions')
    .select('id, tenant_id')
    .eq('stripe_subscription_id', snap.stripeSubscriptionId)
    .maybeSingle();

  let tenantId = existing?.tenant_id as string | undefined;
  if (!tenantId && snap.stripeCustomerId) {
    const { data: tenant } = await admin
      .from('tenants')
      .select('id')
      .eq('stripe_customer_id', snap.stripeCustomerId)
      .maybeSingle();
    tenantId = tenant?.id;
  }
  if (!tenantId) {
    console.warn(`[syncSubscription] no tenant for subscription ${subscription.id}; provisioning may not have run yet`);
    return false;
  }

  const { error } = await admin.from('subscriptions').upsert(
    {
      tenant_id: tenantId,
      product: snap.product,
      status: snap.status,
      source: 'stripe',
      stripe_customer_id: snap.stripeCustomerId,
      stripe_subscription_id: snap.stripeSubscriptionId,
      stripe_price_id: snap.stripePriceId,
      trial_ends_at: snap.trialEndsAt,
      current_period_end: snap.currentPeriodEnd,
      cancel_at_period_end: snap.cancelAtPeriodEnd,
      canceled_at: snap.canceledAt,
      seats: snap.seats,
    },
    { onConflict: 'stripe_subscription_id' }
  );

  if (error) {
    throw new Error(`[syncSubscription] upsert failed: ${error.message}`);
  }
  return true;
}
