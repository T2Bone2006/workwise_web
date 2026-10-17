import Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAppUrl, getStripe } from '@/lib/stripe/client';
import { isBillingInterval, isPlanKey, type PlanChoice } from '@/lib/billing/plans';
import { chooseSignupOffer, fallbackAfterFoundingRefused, getFoundingStatus } from '@/lib/billing/offers';
import { isProTier, type ProChoice } from '@/lib/billing/pro-plans';
import { buildProCheckoutBody } from '@/lib/billing/pro-checkout';
import { signupCheckoutBody } from '@/lib/billing/signup-checkout';

type PendingIntent = {
  id: string;
  product: string;
  billing_interval: string;
  stripe_customer_id: string | null;
  stripe_checkout_session_id: string | null;
  referrer_tenant_id: string | null;
  expected_workers: number | null;
};

export type ResumeCheckout = { kind: 'url'; url: string } | { kind: 'signup' } | { kind: 'dashboard' };

function isFoundingRefusal(err: unknown): boolean {
  if (!(err instanceof Stripe.errors.StripeInvalidRequestError)) return false;
  const param = err.param ?? '';
  return param.startsWith('discounts') || err.code === 'coupon_expired' || err.code === 'resource_missing';
}

function isClosedCheckout(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : '';
  return message.includes('expired') || message.includes('complete');
}

/**
 * Opens a fresh Checkout for a login that still has not paid. The plan, price and
 * discount are the ones already stored on the signup, not anything from the browser.
 * Returns where to send them: Stripe, the sign-up form (no customer yet), or the dashboard.
 */
export async function resumePendingCheckout(authUserId: string): Promise<ResumeCheckout> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('signup_intents')
    .select('id, product, billing_interval, stripe_customer_id, stripe_checkout_session_id, referrer_tenant_id, expected_workers, status')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (error || !data || data.status !== 'pending') return { kind: 'dashboard' };

  const intent = data as PendingIntent;
  if (!intent.stripe_customer_id) return { kind: 'signup' };

  const stripe = getStripe();
  if (intent.stripe_checkout_session_id) {
    try {
      await stripe.checkout.sessions.expire(intent.stripe_checkout_session_id);
    } catch (err) {
      if (!isClosedCheckout(err)) throw err;
    }
  }

  const appUrl = getAppUrl();
  const session = isProTier(intent.product)
    ? await openPro(stripe, intent, appUrl)
    : await openPlan(admin, stripe, intent, appUrl);
  if (!session.url) throw new Error(`checkout had no url intent=${intent.id}`);

  const { error: sessionError } = await admin
    .from('signup_intents')
    .update({ stripe_checkout_session_id: session.id, last_checkout_at: new Date().toISOString() })
    .eq('id', intent.id);
  if (sessionError) throw new Error(`signup_intents session update failed intent=${intent.id}`);
  return { kind: 'url', url: session.url };
}

async function openPlan(
  admin: ReturnType<typeof createAdminClient>,
  stripe: Stripe,
  intent: PendingIntent,
  appUrl: string
): Promise<Stripe.Checkout.Session> {
  if (!isPlanKey(intent.product) || !isBillingInterval(intent.billing_interval) || !intent.stripe_customer_id) {
    throw new Error(`signup intent cannot be resumed intent=${intent.id}`);
  }
  const choice: PlanChoice = { plan: intent.product, interval: intent.billing_interval };
  const referred = Boolean(intent.referrer_tenant_id);
  let offer = chooseSignupOffer({ choice, founding: await getFoundingStatus(), referred });
  try {
    const session = await stripe.checkout.sessions.create(
      signupCheckoutBody({ customerId: intent.stripe_customer_id, intentId: intent.id, choice, offer, appUrl })
    );
    const { error: offerError } = await admin.from('signup_intents').update({ offer: offer.offer }).eq('id', intent.id);
    if (offerError) throw new Error(`signup_intents offer update failed intent=${intent.id}`);
    return session;
  } catch (err) {
    if (offer.offer !== 'founding' || !isFoundingRefusal(err)) throw err;
    offer = fallbackAfterFoundingRefused({ choice, referred });
    const { error: offerError } = await admin.from('signup_intents').update({ offer: offer.offer }).eq('id', intent.id);
    if (offerError) throw new Error(`signup_intents offer update failed intent=${intent.id}`);
    return stripe.checkout.sessions.create(
      signupCheckoutBody({ customerId: intent.stripe_customer_id, intentId: intent.id, choice, offer, appUrl })
    );
  }
}

async function openPro(stripe: Stripe, intent: PendingIntent, appUrl: string): Promise<Stripe.Checkout.Session> {
  if (!isProTier(intent.product) || !isBillingInterval(intent.billing_interval) || !intent.stripe_customer_id) {
    throw new Error(`signup intent cannot be resumed intent=${intent.id}`);
  }
  const choice: ProChoice = { tier: intent.product, interval: intent.billing_interval };
  return stripe.checkout.sessions.create(
    buildProCheckoutBody({
      customerId: intent.stripe_customer_id,
      intentId: intent.id,
      choice,
      appUrl,
      workers: intent.expected_workers,
    })
  );
}
