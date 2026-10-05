import 'server-only';
import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripe } from '@/lib/stripe/client';
import { choiceForPriceId, productsForPriceId, type PlanChoice } from '@/lib/billing/plans';
import type { Product } from '@/lib/data/tenant-products';

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
  products: Product[];
  choice: PlanChoice | null;
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
    products: productsForPriceId(priceId),
    choice: choiceForPriceId(priceId),
    status: KNOWN_STATUSES.has(subscription.status) ? subscription.status : 'incomplete',
    trialEndsAt: toIso(subscription.trial_end),
    currentPeriodEnd: currentPeriodEnd(subscription),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    canceledAt: toIso(subscription.canceled_at),
    seats: item?.quantity ?? 1,
  };
}

function customerIdOf(customer: Stripe.Checkout.Session['customer']): string | null {
  if (!customer) return null;
  return typeof customer === 'string' ? customer : customer.id;
}

function isLiveProductClash(error: { code?: string; message?: string; details?: string | null }): boolean {
  const text = `${error.message ?? ''} ${error.details ?? ''}`;
  return error.code === '23505' && text.includes('uq_subscriptions_live_product');
}

/**
 * Upserts one subscriptions row per product the subscription's price unlocks
 * (onConflict 'stripe_subscription_id,product'), then ends any other row with
 * the same stripe_subscription_id (status 'canceled', canceled_at = now) that
 * the price no longer unlocks. Returns { synced: false, reason } when the
 * price isn't ours or no business owns the subscription yet.
 */
export async function syncSubscription(
  subscription: Stripe.Subscription,
  opts?: { tenantId?: string }
): Promise<
  { synced: true; tenantId: string; products: Product[] } | { synced: false; reason: 'unknown_price' | 'no_tenant' }
> {
  const snap = snapshotSubscription(subscription);
  if (snap.products.length === 0) {
    console.warn(`[syncSubscription] unknown price on ${subscription.id}`);
    return { synced: false, reason: 'unknown_price' };
  }

  const admin = createAdminClient();

  let tenantId = opts?.tenantId;
  if (!tenantId) {
    const { data: existing, error: existingError } = await admin
      .from('subscriptions')
      .select('tenant_id')
      .eq('stripe_subscription_id', snap.stripeSubscriptionId)
      .limit(1);
    if (existingError) {
      throw new Error(`[syncSubscription] lookup failed for ${subscription.id}: ${existingError.message}`);
    }
    tenantId = existing?.[0]?.tenant_id as string | undefined;
  }
  if (!tenantId && snap.stripeCustomerId) {
    const { data: tenant, error: tenantError } = await admin
      .from('tenants')
      .select('id')
      .eq('stripe_customer_id', snap.stripeCustomerId)
      .maybeSingle();
    if (tenantError) {
      throw new Error(`[syncSubscription] tenant lookup failed for ${subscription.id}: ${tenantError.message}`);
    }
    tenantId = tenant?.id;
  }
  if (!tenantId) {
    console.warn(`[syncSubscription] no tenant for subscription ${subscription.id}`);
    return { synced: false, reason: 'no_tenant' };
  }

  // Unlock the current products first, then end anything this price no longer covers.
  for (const product of snap.products) {
    const { error } = await admin.from('subscriptions').upsert(
      {
        tenant_id: tenantId,
        product,
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
        plan: snap.choice?.plan ?? null,
        billing_interval: snap.choice?.interval ?? null,
      },
      { onConflict: 'stripe_subscription_id,product' }
    );
    if (error) {
      if (isLiveProductClash(error)) {
        throw new Error(`[syncSubscription] live product clash on ${subscription.id}: ${error.message}`);
      }
      throw new Error(`[syncSubscription] upsert failed for ${subscription.id}: ${error.message}`);
    }
  }

  const { data: rows, error: listError } = await admin
    .from('subscriptions')
    .select('id, product')
    .eq('stripe_subscription_id', snap.stripeSubscriptionId);
  if (listError) {
    throw new Error(`[syncSubscription] list failed for ${subscription.id}: ${listError.message}`);
  }

  const keep = new Set(snap.products);
  const canceledAt = new Date().toISOString();
  for (const row of rows ?? []) {
    if (keep.has(row.product as Product)) continue;
    const { error } = await admin
      .from('subscriptions')
      .update({ status: 'canceled', canceled_at: canceledAt })
      .eq('id', row.id);
    if (error) {
      throw new Error(`[syncSubscription] cancel failed for ${subscription.id}: ${error.message}`);
    }
  }

  return { synced: true, tenantId, products: snap.products };
}

/** metadata.kind === 'restart': the tenant comes from metadata.tenant_id and
 *  must own session.customer (tenants.stripe_customer_id); then sync. */
export async function syncRestartSession(session: Stripe.Checkout.Session): Promise<void> {
  const tenantId = session.metadata?.tenant_id;
  if (!tenantId) {
    throw new Error(`[syncRestart] session ${session.id} has no tenant_id`);
  }
  const customerId = customerIdOf(session.customer);
  if (!customerId) {
    throw new Error(`[syncRestart] session ${session.id} has no customer`);
  }

  const admin = createAdminClient();
  const { data: tenant, error } = await admin
    .from('tenants')
    .select('id, stripe_customer_id')
    .eq('id', tenantId)
    .maybeSingle();
  if (error) {
    throw new Error(`[syncRestart] tenant lookup failed for session ${session.id}: ${error.message}`);
  }
  if (!tenant || tenant.stripe_customer_id !== customerId) {
    console.error(`[syncRestart] tenant mismatch session=${session.id} tenant=${tenantId}`);
    throw new Error(`[syncRestart] tenant ${tenantId} does not own the Stripe customer`);
  }

  const subscriptionRef = session.subscription;
  if (!subscriptionRef) {
    throw new Error(`[syncRestart] session ${session.id} has no subscription`);
  }
  const subscription =
    typeof subscriptionRef === 'string'
      ? await getStripe().subscriptions.retrieve(subscriptionRef)
      : subscriptionRef;

  const result = await syncSubscription(subscription, { tenantId });
  if (!result.synced) {
    throw new Error(`[syncRestart] sync failed for ${subscription.id}: ${result.reason}`);
  }
}
