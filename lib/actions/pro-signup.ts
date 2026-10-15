'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripe, getAppUrl } from '@/lib/stripe/client';
import { buildProCheckoutBody } from '@/lib/billing/pro-checkout';
import { EXTRA_WORKER_PRICE_ENV, extraWorkerPriceIdFor, proPlanPriceId } from '@/lib/billing/pro-plan-prices';
import { PRO_PLANS, proCost, type ProChoice } from '@/lib/billing/pro-plans';
import { isOwnReferral, lookupReferrer, normaliseReferralCode, REFERRAL_COOKIE } from '@/lib/billing/offers';
import { proSignupSchema } from '@/lib/validations/pro-signup';

export type ProSignupResult = {
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

function failure(error: string): ProSignupResult {
  return { success: false, error, attemptedAt: Date.now() };
}

function isAlreadyRegistered(message: string): boolean {
  return /already|exists|registered/i.test(message);
}

function isClosedCheckout(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : '';
  return message.includes('expired') || message.includes('complete');
}

async function maybeTestClock(stripe: Stripe, intentId: string): Promise<string | undefined> {
  if (process.env.STRIPE_SIGNUP_TEST_CLOCK !== '1') return undefined;
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  if (!key.startsWith('sk_test_')) {
    console.warn(`[startProSignup] test clock ignored intent=${intentId}`);
    return undefined;
  }
  const clock = await stripe.testHelpers.testClocks.create({
    frozen_time: Math.floor(Date.now() / 1000),
    name: intentId,
  });
  return clock.id;
}

/**
 * Pro self-serve signup. Creates or resumes a pending signup and redirects to Stripe Checkout for the plan
 * plus any extra workers already in the team size they entered. No trial, no discount, no promotion-code box.
 * The worker number is also stored as `expected_workers`. A referral is recorded so the referrer can be
 * rewarded later; it changes nothing at Checkout.
 */
export async function startProSignup(_prev: unknown, formData: FormData): Promise<ProSignupResult> {
  const parsed = proSignupSchema.safeParse({
    tier: formData.get('tier'),
    interval: formData.get('interval'),
    workers: formData.get('workers') ?? '',
    businessName: formData.get('businessName'),
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    password: formData.get('password'),
    phone: formData.get('phone'),
    trade: formData.get('trade'),
    ref: formData.get('ref') ?? '',
  });

  if (!parsed.success) {
    return failure(parsed.error.issues[0]?.message ?? 'Please check the form and try again.');
  }

  const values = parsed.data;
  const email = values.email.toLowerCase();
  const choice: ProChoice = { tier: values.tier, interval: values.interval };

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

  let checkoutUrl: string;
  try {
    // Read the price ids first: a missing env var must fail before anything is written.
    proPlanPriceId(choice);
    const team = values.workers ?? PRO_PLANS[choice.tier].included;
    if (proCost(choice, team).extras > 0 && !extraWorkerPriceIdFor(choice.tier, choice.interval)) {
      const envName = EXTRA_WORKER_PRICE_ENV[choice.tier][choice.interval];
      throw new Error(`Missing ${envName} for ${choice.tier}/${choice.interval}`);
    }

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
      if (pendingError) throw new Error('signup_intents lookup failed');
      if (!pending) return failure(ALREADY_EXISTS);

      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: values.password });
      if (signInError) return failure(ALREADY_EXISTS);
      resume = pending as IntentRow;
      authUserId = pending.auth_user_id as string;
    } else {
      authUserId = created.data.user.id;
    }

    const intentFields = {
      product: choice.tier,
      billing_interval: choice.interval,
      business_name: values.businessName,
      full_name: values.fullName,
      phone: values.phone,
      postcode: null,
      trade: values.trade,
      expected_workers: values.workers ?? null,
      referral_code: referrer?.code ?? null,
      referrer_tenant_id: referrer?.tenantId ?? null,
      offer: 'none',
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
          tier: choice.tier,
          interval: choice.interval,
          kind: 'pro_signup',
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
      if (signInError) console.warn(`[startProSignup] sign-in after create failed intent=${intentId}`);
    }

    const session = await stripe.checkout.sessions.create(
      buildProCheckoutBody({ customerId, intentId, choice, appUrl: getAppUrl(), workers: values.workers }),
    );
    if (!session.url) throw new Error(`checkout had no url intent=${intentId}`);

    const { error: sessionError } = await admin
      .from('signup_intents')
      .update({ stripe_checkout_session_id: session.id, last_checkout_at: new Date().toISOString(), offer: 'none' })
      .eq('id', intentId);
    if (sessionError) throw new Error(`signup_intents session update failed intent=${intentId}`);
    checkoutUrl = session.url;
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Error';
    console.error(`[startProSignup] ${name}`);
    return failure(START_FAILED);
  }

  redirect(checkoutUrl);
}
