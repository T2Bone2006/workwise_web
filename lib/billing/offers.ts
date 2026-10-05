import 'server-only';

import { unstable_cache } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripe } from '@/lib/stripe/client';
import { ENTITLED_STATUSES, PRO_TIER_PRODUCTS } from '@/lib/data/tenant-products';
import { formatPence, PLANS, type PlanChoice, type PlanKey } from '@/lib/billing/plans';

export const REFERRAL_COOKIE = 'ww_ref';
export const REFERRAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 60; // 60 days, seconds
export const REFERRAL_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;
export const FOUNDING_PLACES = 200;

const UNKNOWN_FOUNDING = { active: null, placesLeft: null, places: FOUNDING_PLACES } as const;

/** Trim + uppercase; null unless it matches REFERRAL_CODE_RE. */
export function normaliseReferralCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return REFERRAL_CODE_RE.test(code) ? code : null;
}

export type FoundingStatus = {
  active: boolean | null; // null = couldn't ask Stripe (show the offer, no count)
  placesLeft: number | null;
  places: number; // 200
};

async function readFoundingCoupon(): Promise<FoundingStatus> {
  const couponId = process.env.STRIPE_COUPON_FOUNDING;
  if (!couponId) throw new Error('Missing STRIPE_COUPON_FOUNDING');
  const stripe = getStripe();
  const coupon = await stripe.coupons.retrieve(couponId);
  if (coupon.max_redemptions == null) throw new Error('Founding coupon has no redemption limit');
  // A referred friend's half-price second month is a founding place too, but it is a different coupon,
  // so its redemptions are counted here as well.
  const halfId = process.env.STRIPE_COUPON_REFERRAL_SECOND_HALF;
  const referredPlaces = halfId ? ((await stripe.coupons.retrieve(halfId)).times_redeemed ?? 0) : 0;
  const placesLeft = Math.max(0, coupon.max_redemptions - (coupon.times_redeemed ?? 0) - referredPlaces);
  return { active: placesLeft > 0, placesLeft, places: FOUNDING_PLACES };
}

const cachedFoundingStatus = unstable_cache(readFoundingCoupon, ['founding-status'], { revalidate: 600 });

/** Places left = the founding coupon's limit minus its redemptions minus the referred friends'
 *  half-price second months (STRIPE_COUPON_REFERRAL_SECOND_HALF). Cached 10 min with next/cache
 *  unstable_cache(['founding-status'], { revalidate: 600 }). Errors are not
 *  cached: on any Stripe/env error returns { active: null, placesLeft: null, places: 200 }. */
export async function getFoundingStatus(): Promise<FoundingStatus> {
  try {
    return await cachedFoundingStatus();
  } catch {
    return { ...UNKNOWN_FOUNDING };
  }
}

export type Referrer = { tenantId: string; businessName: string; code: string };

/** Service-role lookup. Valid only if: tenants.referral_code = code, closed_at IS NULL,
 *  a subscriptions row with source 'stripe', product rounds|lite, status in ENTITLED_STATUSES,
 *  and no manual / starter|growth|pro row. Otherwise null. */
export async function lookupReferrer(code: string): Promise<Referrer | null> {
  const normalised = normaliseReferralCode(code);
  if (!normalised) return null;
  try {
    const admin = createAdminClient();
    const { data: tenant, error } = await admin
      .from('tenants')
      .select('id, name, closed_at')
      .eq('referral_code', normalised)
      .is('closed_at', null)
      .maybeSingle();
    if (error || !tenant || typeof tenant.id !== 'string') return null;

    const { data: subs, error: subError } = await admin
      .from('subscriptions')
      .select('source, product, status')
      .eq('tenant_id', tenant.id);
    if (subError || !subs) return null;

    const blocked = subs.some(
      (row) => row.source === 'manual' || (PRO_TIER_PRODUCTS as readonly string[]).includes(row.product)
    );
    if (blocked) return null;

    const entitled = new Set<string>(ENTITLED_STATUSES);
    const live = subs.some(
      (row) =>
        row.source === 'stripe' &&
        (row.product === 'rounds' || row.product === 'lite') &&
        entitled.has(row.status)
    );
    if (!live) return null;

    const businessName = typeof tenant.name === 'string' ? tenant.name : '';
    return { tenantId: tenant.id, businessName, code: normalised };
  } catch {
    return null;
  }
}

/** True when `email` (lowercased) is the login email of any admin of the referrer. */
export async function isOwnReferral(referrer: Referrer, email: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('users')
    .select('email')
    .eq('tenant_id', referrer.tenantId)
    .eq('role', 'admin');
  if (error) throw new Error('referral check failed');
  const wanted = email.trim().toLowerCase();
  return (data ?? []).some((row) => typeof row.email === 'string' && row.email.toLowerCase() === wanted);
}

export type SignupOfferKind = 'none' | 'founding' | 'free_month' | 'month_off_year';
export type SignupOffer = {
  offer: SignupOfferKind;
  /** Referred monthly sign-up while founding runs: month 1 free (the 100% coupon), then month 2 half price.
   *  The DB still stores 'free_month'; the half-price coupon is added by the webhook after the first invoice. */
  secondMonthHalf: boolean;
  couponEnv:
    | 'STRIPE_COUPON_FOUNDING'
    | 'STRIPE_COUPON_REFERRAL_MONTH'
    | 'STRIPE_COUPON_REFERRAL_YEAR_35'
    | 'STRIPE_COUPON_REFERRAL_YEAR_59'
    | null;
  headline: string | null;
};

/** What the sign-up page shows. Like SignupOfferKind plus the free-then-half deal. */
export type SignupOfferView = SignupOfferKind | 'free_then_half';

export function offerView(offer: SignupOffer): SignupOfferView {
  return offer.secondMonthHalf ? 'free_then_half' : offer.offer;
}

function halfMonth(plan: PlanKey): string {
  return formatPence(Math.round(PLANS[plan].pence.month / 2));
}

function headlineFor(kind: Exclude<SignupOfferKind, 'none'> | 'free_then_half', plan: PlanKey): string {
  const month = formatPence(PLANS[plan].pence.month);
  const year = formatPence(PLANS[plan].pence.year);
  if (kind === 'founding') {
    return `Founding offer: half price for your first 2 months (${halfMonth(plan)}), then ${month} a month.`;
  }
  if (kind === 'free_month') {
    return `Your first month is free, then ${month} a month.`;
  }
  if (kind === 'free_then_half') {
    return `Your first month is free, your second is half price (${halfMonth(plan)}), then ${month} a month.`;
  }
  const today = formatPence(PLANS[plan].pence.year - PLANS[plan].pence.month);
  return `${month} off your first year: ${today} today, then ${year} a year.`;
}

function monthOffYear(plan: PlanKey): SignupOffer {
  return {
    offer: 'month_off_year',
    secondMonthHalf: false,
    couponEnv: plan === 'both' ? 'STRIPE_COUPON_REFERRAL_YEAR_59' : 'STRIPE_COUPON_REFERRAL_YEAR_35',
    headline: headlineFor('month_off_year', plan),
  };
}

function freeMonth(plan: PlanKey, thenHalf = false): SignupOffer {
  return {
    offer: 'free_month',
    secondMonthHalf: thenHalf,
    couponEnv: 'STRIPE_COUPON_REFERRAL_MONTH',
    headline: headlineFor(thenHalf ? 'free_then_half' : 'free_month', plan),
  };
}

function founding(plan: PlanKey): SignupOffer {
  return {
    offer: 'founding',
    secondMonthHalf: false,
    couponEnv: 'STRIPE_COUPON_FOUNDING',
    headline: headlineFor('founding', plan),
  };
}

const NONE: SignupOffer = { offer: 'none', secondMonthHalf: false, couponEnv: null, headline: null };

/** Pure. Monthly while founding is active (or unknown): referred → first month free, second half price
 *  (month 3 full); not referred → founding (half price for 2 months). Founding over: referred → first
 *  month free. Yearly: referred → one month's price off the year. Otherwise none. */
export function chooseSignupOffer(input: { choice: PlanChoice; founding: FoundingStatus; referred: boolean }): SignupOffer {
  const { choice, founding: foundingStatus, referred } = input;
  const foundingOn = choice.interval === 'month' && foundingStatus.active !== false;
  if (foundingOn && referred) return freeMonth(choice.plan, true);
  if (foundingOn) return founding(choice.plan);
  if (referred && choice.interval === 'month') return freeMonth(choice.plan);
  if (referred && choice.interval === 'year') return monthOffYear(choice.plan);
  return NONE;
}

/** The offer to use if Stripe refuses the founding coupon at Checkout. */
export function fallbackAfterFoundingRefused(input: { choice: PlanChoice; referred: boolean }): SignupOffer {
  const { choice, referred } = input;
  if (referred && choice.interval === 'month') return freeMonth(choice.plan);
  if (referred && choice.interval === 'year') return monthOffYear(choice.plan);
  return NONE;
}

/** server. The one-time 50% coupon added for a referred friend's second month. Throws when unset. */
export function secondMonthCouponId(): string {
  const id = process.env.STRIPE_COUPON_REFERRAL_SECOND_HALF;
  if (!id) throw new Error('Missing STRIPE_COUPON_REFERRAL_SECOND_HALF');
  return id;
}

/** server. Reads the coupon id from env; throws `Missing STRIPE_COUPON_…` when unset. */
export function couponIdFor(offer: SignupOffer): string | null {
  if (!offer.couponEnv) return null;
  const id = process.env[offer.couponEnv];
  if (!id) throw new Error(`Missing ${offer.couponEnv}`);
  return id;
}
