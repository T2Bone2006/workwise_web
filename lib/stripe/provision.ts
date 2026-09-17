import 'server-only';
import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripe } from '@/lib/stripe/client';
import { snapshotSubscription } from '@/lib/stripe/sync-subscription';
import { postcodeToLatLng } from '@/lib/utils/postcode';

/**
 * Turns a completed Checkout Session into a provisioned account.
 *
 * All the row creation happens inside the SQL function
 * provision_tenant_from_intent() in one transaction; this file only gathers
 * the inputs from Stripe and calls it. Safe to call repeatedly for the same
 * session: the function returns the existing tenant on a second run.
 */
export async function provisionFromCheckoutSession(session: Stripe.Checkout.Session): Promise<string> {
  const intentId = session.client_reference_id;
  if (!intentId) {
    throw new Error(`checkout session ${session.id} has no client_reference_id`);
  }

  const stripe = getStripe();
  const subscriptionRef = session.subscription;
  if (!subscriptionRef) {
    throw new Error(`checkout session ${session.id} has no subscription`);
  }
  const subscription =
    typeof subscriptionRef === 'string'
      ? await stripe.subscriptions.retrieve(subscriptionRef)
      : subscriptionRef;
  const snap = snapshotSubscription(subscription);

  const customerId =
    typeof session.customer === 'string' ? session.customer : session.customer?.id ?? snap.stripeCustomerId;

  const admin = createAdminClient();

  // Remember which session paid for this intent (idempotency + support lookups).
  await admin
    .from('signup_intents')
    .update({ stripe_checkout_session_id: session.id, stripe_customer_id: customerId })
    .eq('id', intentId)
    .is('stripe_checkout_session_id', null);

  const { data: tenantId, error } = await admin.rpc('provision_tenant_from_intent', {
    p_intent_id: intentId,
    p_stripe_customer_id: customerId,
    p_stripe_subscription_id: snap.stripeSubscriptionId,
    p_stripe_price_id: snap.stripePriceId,
    p_subscription_status: snap.status,
    p_trial_ends_at: snap.trialEndsAt,
    p_current_period_end: snap.currentPeriodEnd,
  });

  if (error || !tenantId) {
    throw new Error(`provision_tenant_from_intent failed: ${error?.message ?? 'no tenant id returned'}`);
  }

  // Stripe metadata so the customer is findable from the Stripe dashboard.
  if (customerId) {
    await stripe.customers
      .update(customerId, { metadata: { workwise_tenant_id: String(tenantId) } })
      .catch((err: unknown) => console.warn('[provision] customer metadata update failed', err));
  }

  await geocodeWorkerHome(String(tenantId));

  return String(tenantId);
}

/** Best-effort: give the Rounds owner's worker row coordinates for route ordering. */
async function geocodeWorkerHome(tenantId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: worker } = await admin
      .from('workers')
      .select('id, home_postcode, home_lat')
      .eq('primary_tenant_id', tenantId)
      .maybeSingle();
    if (!worker?.home_postcode || worker.home_lat != null) return;

    const coords = await postcodeToLatLng(worker.home_postcode);
    if (!coords) return;
    await admin
      .from('workers')
      .update({ home_lat: coords.lat, home_lng: coords.lng })
      .eq('id', worker.id);
  } catch (err) {
    console.warn('[provision] geocode failed (non-fatal)', err);
  }
}
