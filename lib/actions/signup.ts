'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripe, getAppUrl } from '@/lib/stripe/client';
import { priceIdForProduct, TRIAL_DAYS, PRODUCT_LABELS } from '@/lib/stripe/products';
import { signupSchema } from '@/lib/validations/signup';

export type SignupResult = {
  success: boolean;
  error?: string;
  attemptedAt?: number;
};

/**
 * Self-serve signup, step 1 of 2.
 *
 *   1. Create the auth user (email pre-confirmed; Stripe verifies the card).
 *   2. Record a signup_intent with everything provisioning will need.
 *   3. Create the Stripe customer and sign the user in so the session cookie
 *      exists when they return from Checkout.
 *   4. Redirect to Stripe Checkout (subscription, 14-day trial, card upfront).
 *
 * Step 2 of 2 is the webhook (app/api/stripe/webhook) which provisions the
 * account when checkout.session.completed arrives.
 */
export async function startSignup(_prev: unknown, formData: FormData): Promise<SignupResult> {
  const parsed = signupSchema.safeParse({
    product: formData.get('product'),
    businessName: formData.get('businessName'),
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    password: formData.get('password'),
    phone: formData.get('phone'),
    postcode: formData.get('postcode'),
    trade: formData.get('trade') ?? '',
  });

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? 'Please check the form and try again.',
      attemptedAt: Date.now(),
    };
  }
  const values = parsed.data;
  const email = values.email.toLowerCase();

  let checkoutUrl: string;
  try {
    const admin = createAdminClient();

    // 1. Auth user.
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: values.password,
      email_confirm: true,
      user_metadata: { full_name: values.fullName },
    });

    if (createError || !created.user) {
      const alreadyExists = /already|exists|registered/i.test(createError?.message ?? '');
      return {
        success: false,
        error: alreadyExists
          ? 'An account with this email already exists. Please sign in instead.'
          : 'We could not create your account. Please try again.',
        attemptedAt: Date.now(),
      };
    }
    const authUserId = created.user.id;

    // 2. Intent.
    const { data: intent, error: intentError } = await admin
      .from('signup_intents')
      .insert({
        auth_user_id: authUserId,
        email,
        product: values.product,
        business_name: values.businessName,
        full_name: values.fullName,
        phone: values.phone,
        postcode: values.postcode,
        trade: values.trade || null,
      })
      .select('id')
      .single();

    if (intentError || !intent) {
      throw new Error(`signup_intents insert failed: ${intentError?.message}`);
    }

    // 3. Stripe customer + session cookie.
    const stripe = getStripe();
    const customer = await stripe.customers.create({
      email,
      name: values.businessName,
      phone: values.phone,
      metadata: {
        signup_intent_id: intent.id,
        product: values.product,
        contact_name: values.fullName,
      },
    });

    await admin.from('signup_intents').update({ stripe_customer_id: customer.id }).eq('id', intent.id);

    const supabase = await createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: values.password });
    if (signInError) {
      // Not fatal: /signup/complete will ask them to sign in if no session.
      console.warn('[startSignup] sign-in after create failed', signInError.message);
    }

    // 4. Checkout.
    const appUrl = getAppUrl();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customer.id,
      client_reference_id: intent.id,
      line_items: [{ price: priceIdForProduct(values.product), quantity: 1 }],
      subscription_data: {
        trial_period_days: TRIAL_DAYS,
        metadata: { signup_intent_id: intent.id, product: values.product },
      },
      payment_method_collection: 'always',
      allow_promotion_codes: true,
      success_url: `${appUrl}/signup/complete?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/signup?product=${values.product}&canceled=1`,
      custom_text: {
        submit: { message: `${PRODUCT_LABELS[values.product]}: ${TRIAL_DAYS}-day free trial, cancel any time.` },
      },
    });

    if (!session.url) {
      throw new Error('Stripe did not return a checkout URL');
    }
    await admin.from('signup_intents').update({ stripe_checkout_session_id: session.id }).eq('id', intent.id);
    checkoutUrl = session.url;
  } catch (err) {
    console.error('[startSignup]', err);
    return {
      success: false,
      error: 'Something went wrong starting your subscription. Please try again.',
      attemptedAt: Date.now(),
    };
  }

  redirect(checkoutUrl);
}
