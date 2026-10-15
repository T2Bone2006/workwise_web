'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripe, getAppUrl } from '@/lib/stripe/client';
import { PLANS, priceIdFor, priceLabel, type PlanChoice } from '@/lib/billing/plans';
import {
  chooseSignupOffer,
  couponIdFor,
  fallbackAfterFoundingRefused,
  getFoundingStatus,
  isOwnReferral,
  lookupReferrer,
  normaliseReferralCode,
  REFERRAL_COOKIE,
  type SignupOffer,
} from '@/lib/billing/offers';
import { signupSchema } from '@/lib/validations/signup';

export type SignupResult = {
  success: boolean;
  error?: string;
  attemptedAt?: number;
};

const ALREADY_EXISTS = 'An account with this email already exists. Please sign in instead.';
const START_FAILED = 'Something went wrong starting your subscription. Please try again.';

type IntentRow = {
  id: string;
  auth_user_id: string;
  stripe_customer_id: string | null;
  stripe_checkout_session_id: string | null;
};

function failure(error: string): SignupResult {
  return { success: false, error, attemptedAt: Date.now() };
}

function isAlreadyRegistered(message: string): boolean {
  return /already|exists|registered/i.test(message);
}

function isFoundingRefusal(err: unknown): boolean {
  if (!(err instanceof Stripe.errors.StripeInvalidRequestError)) return false;
  const param = err.param ?? '';
  return param.startsWith('discounts') || err.code === 'coupon_expired' || err.code === 'resource_missing';
}

function isClosedCheckout(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : '';
  return message.includes('expired') || message.includes('complete');
}

async function maybeTestClock(stripe: Stripe, intentId: string): Promise<string | undefined> {
  if (process.env.STRIPE_SIGNUP_TEST_CLOCK !== '1') return undefined;
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  if (!key.startsWith('sk_test_')) {
    console.warn(`[startSignup] test clock ignored intent=${intentId}`);
    return undefined;
  }
  const clock = await stripe.testHelpers.testClocks.create({
    frozen_time: Math.floor(Date.now() / 1000),
    name: intentId,
  });
  return clock.id;
}

function checkoutBody(input: {
  customerId: string;
  intentId: string;
  choice: PlanChoice;
  offer: SignupOffer;
  appUrl: string;
}) {
  const coupon = couponIdFor(input.offer);
  const { plan, interval } = input.choice;
  return {
    mode: 'subscription' as const,
    customer: input.customerId,
    client_reference_id: input.intentId,
    line_items: [{ price: priceIdFor(input.choice), quantity: 1 }],
    subscription_data: {
      metadata: {
        signup_intent_id: input.intentId,
        plan,
        interval,
        offer: input.offer.offer,
        ...(input.offer.secondMonthHalf ? { second_month_half: '1' } : {}),
      },
    },
    ...(coupon ? { discounts: [{ coupon }] } : { allow_promotion_codes: true as const }),
    payment_method_collection: 'always' as const,
    success_url: `${input.appUrl}/signup/complete?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.appUrl}/signup?plan=${plan}&interval=${interval}&canceled=1`,
    custom_text: {
      submit: {
        message: input.offer.headline ?? `${PLANS[plan].label}: ${priceLabel(input.choice)}. Cancel any time.`,
      },
    },
  };
}

/**
 * Self-serve signup. Creates or resumes a pending signup and redirects to
 * Stripe Checkout. No trial. One coupon at Checkout (a referred friend's half-price second month is added by the webhook after the first invoice).
 */
export async function startSignup(_prev: unknown, formData: FormData): Promise<SignupResult> {
  const parsed = signupSchema.safeParse({
    plan: formData.get('plan'),
    interval: formData.get('interval'),
    businessName: formData.get('businessName'),
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    password: formData.get('password'),
    phone: formData.get('phone'),
    postcode: formData.get('postcode'),
    trade: formData.get('trade') ?? '',
    ref: formData.get('ref') ?? '',
  });

  if (!parsed.success) {
    return failure(parsed.error.issues[0]?.message ?? 'Please check the form and try again.');
  }

  const values = parsed.data;
  const email = values.email.toLowerCase();
  const choice: PlanChoice = { plan: values.plan, interval: values.interval };

  const cookieStore = await cookies();
  const code =
    normaliseReferralCode(values.ref) ?? normaliseReferralCode(cookieStore.get(REFERRAL_COOKIE)?.value);
  let referrer = code ? await lookupReferrer(code) : null;
  if (referrer) {
    try {
      if (await isOwnReferral(referrer, email)) referrer = null;
    } catch {
      referrer = null;
    }
  }

  let offer = chooseSignupOffer({
    choice,
    founding: await getFoundingStatus(),
    referred: Boolean(referrer),
  });

  let checkoutUrl: string;
  try {
    const admin = createAdminClient();
    const stripe = getStripe();
    const supabase = await createClient();

    const created = await admin.auth.admin.createUser({
      email,
      password: values.password,
      email_confirm: true,
      user_metadata: { full_name: values.fullName },
    });

    let authUserId: string;
    let resume: IntentRow | null = null;

    if (created.error || !created.data?.user) {
      if (!isAlreadyRegistered(created.error?.message ?? '')) {
        return failure('We could not create your account. Please try again.');
      }
      const { data: pending, error: pendingError } = await admin
        .from('signup_intents')
        .select('id, auth_user_id, stripe_customer_id, stripe_checkout_session_id')
        .eq('email', email)
        .eq('status', 'pending')
        .maybeSingle();
      if (pendingError) throw new Error(`signup_intents lookup failed`);
      if (!pending) return failure(ALREADY_EXISTS);

      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: values.password });
      if (signInError) return failure(ALREADY_EXISTS);
      resume = pending as IntentRow;
      authUserId = pending.auth_user_id as string;
    } else {
      authUserId = created.data.user.id;
    }

    const intentFields = {
      product: values.plan,
      billing_interval: values.interval,
      business_name: values.businessName,
      full_name: values.fullName,
      phone: values.phone,
      postcode: values.postcode,
      trade: values.trade || null,
      referral_code: referrer?.code ?? null,
      referrer_tenant_id: referrer?.tenantId ?? null,
      offer: offer.offer,
    };

    let intentId: string;
    let customerId: string | null;

    if (resume) {
      if (resume.stripe_checkout_session_id) {
        try {
          await stripe.checkout.sessions.expire(resume.stripe_checkout_session_id);
        } catch (err) {
          if (!isClosedCheckout(err)) throw err;
        }
      }
      const { error: updateError } = await admin.from('signup_intents').update(intentFields).eq('id', resume.id);
      if (updateError) throw new Error(`signup_intents update failed intent=${resume.id}`);
      intentId = resume.id;
      customerId = resume.stripe_customer_id;
    } else {
      const { data: inserted, error: insertError } = await admin
        .from('signup_intents')
        .insert({ auth_user_id: authUserId, email, ...intentFields })
        .select('id')
        .single();
      if (insertError || !inserted) throw new Error('signup_intents insert failed');
      intentId = inserted.id as string;
      customerId = null;
    }

    if (!customerId) {
      const testClock = await maybeTestClock(stripe, intentId);
      const customer = await stripe.customers.create({
        email,
        name: values.businessName,
        phone: values.phone,
        ...(testClock ? { test_clock: testClock } : {}),
        metadata: {
          signup_intent_id: intentId,
          plan: values.plan,
          interval: values.interval,
          contact_name: values.fullName,
        },
      });
      customerId = customer.id;
      const { error: customerError } = await admin
        .from('signup_intents')
        .update({ stripe_customer_id: customerId })
        .eq('id', intentId);
      if (customerError) throw new Error(`signup_intents customer update failed intent=${intentId}`);
    }

    if (!resume) {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: values.password });
      if (signInError) console.warn(`[startSignup] sign-in after create failed intent=${intentId}`);
    }

    const appUrl = getAppUrl();
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create(
        checkoutBody({ customerId, intentId, choice, offer, appUrl })
      );
    } catch (err) {
      if (offer.offer !== 'founding' || !isFoundingRefusal(err)) throw err;
      offer = fallbackAfterFoundingRefused({ choice, referred: Boolean(referrer) });
      const { error: offerError } = await admin.from('signup_intents').update({ offer: offer.offer }).eq('id', intentId);
      if (offerError) throw new Error(`signup_intents offer update failed intent=${intentId}`);
      session = await stripe.checkout.sessions.create(
        checkoutBody({ customerId, intentId, choice, offer, appUrl })
      );
    }

    if (!session.url) throw new Error(`checkout had no url intent=${intentId}`);

    const { error: sessionError } = await admin
      .from('signup_intents')
      .update({
        stripe_checkout_session_id: session.id,
        last_checkout_at: new Date().toISOString(),
        offer: offer.offer,
      })
      .eq('id', intentId);
    if (sessionError) throw new Error(`signup_intents session update failed intent=${intentId}`);
    checkoutUrl = session.url;
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Error';
    console.error(`[startSignup] ${name}`);
    return failure(START_FAILED);
  }

  redirect(checkoutUrl);
}
