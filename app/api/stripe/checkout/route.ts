import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripe, getAppUrl } from '@/lib/stripe/client';
import { priceIdForProduct, TRIAL_DAYS, isSelfServeProduct } from '@/lib/stripe/products';

/**
 * Resume payment for a signed-in user whose signup intent is still pending
 * (they closed Checkout, or the webhook hasn't landed and they want to retry).
 * Creates a fresh Checkout Session for the same intent and redirects to it.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${getAppUrl()}/login`);
  }

  const admin = createAdminClient();
  const { data: intent } = await admin
    .from('signup_intents')
    .select('id, product, stripe_customer_id, status')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (!intent || intent.status === 'provisioned') {
    return NextResponse.redirect(`${getAppUrl()}/dashboard`);
  }
  if (!isSelfServeProduct(intent.product) || !intent.stripe_customer_id) {
    return NextResponse.redirect(`${getAppUrl()}/signup`);
  }

  const appUrl = getAppUrl();
  const session = await getStripe().checkout.sessions.create({
    mode: 'subscription',
    customer: intent.stripe_customer_id,
    client_reference_id: intent.id,
    line_items: [{ price: priceIdForProduct(intent.product), quantity: 1 }],
    subscription_data: {
      trial_period_days: TRIAL_DAYS,
      metadata: { signup_intent_id: intent.id, product: intent.product },
    },
    payment_method_collection: 'always',
    allow_promotion_codes: true,
    success_url: `${appUrl}/signup/complete?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/signup/complete?canceled=1`,
  });

  if (!session.url) {
    return NextResponse.json({ error: 'Could not create checkout session' }, { status: 500 });
  }
  await admin.from('signup_intents').update({ stripe_checkout_session_id: session.id }).eq('id', intent.id);
  return NextResponse.redirect(session.url);
}
