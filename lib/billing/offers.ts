import 'server-only';

import { unstable_cache } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { ENTITLED_STATUSES, PRO_TIER_PRODUCTS } from '@/lib/data/tenant-products';
import {
  formatPence,
  PLANS,
  REFERRED_TRIAL_DAYS,
  TRIAL_DAYS,
  type BillingInterval,
  type PlanChoice,
  type PlanKey,
} from '@/lib/billing/plans';

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

async function readFoundingPlaces(): Promise<FoundingStatus> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('founder_places_taken');
  if (error || typeof data !== 'number') throw new Error('founder places unavailable');
  const placesLeft = Math.max(0, FOUNDING_PLACES - data);
  return { active: placesLeft > 0, placesLeft, places: FOUNDING_PLACES };
}

const cachedFoundingStatus = unstable_cache(readFoundingPlaces, ['founding-status'], { revalidate: 600 });

/** Places left = 200 minus the founder places in use (founder_places, released when a trial is cancelled).
 *  Cached 10 min with next/cache unstable_cache(['founding-status'], { revalidate: 600 }). Errors are not
 *  cached: on any database error returns { active: null, placesLeft: null, places: 200 }. This is only for
 *  showing the offer; the place itself is claimed atomically in the database after checkout. */
export async function getFoundingStatus(): Promise<FoundingStatus> {
  try {
    return await cachedFoundingStatus();
  } catch {
    return { ...UNKNOWN_FOUNDING };
  }
}

export type Referrer = { tenantId: string; businessName: string; code: string };

/** Service-role lookup. Valid only if: tenants.referral_code = code, closed_at IS NULL,
 *  a subscriptions row with source 'stripe', product rounds|lite|starter|growth|pro, status in ENTITLED_STATUSES,
 *  and no manual row and no Pro-tier row that isn't Stripe-billed. Otherwise null. */
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
      (row) =>
        row.source === 'manual' ||
        ((PRO_TIER_PRODUCTS as readonly string[]).includes(row.product) && row.source !== 'stripe')
    );
    if (blocked) return null;

    const entitled = new Set<string>(ENTITLED_STATUSES);
    const live = subs.some(
      (row) =>
        row.source === 'stripe' &&
        (row.product === 'rounds' || row.product === 'lite' || (PRO_TIER_PRODUCTS as readonly string[]).includes(row.product)) &&
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

export { REFERRED_TRIAL_DAYS, TRIAL_DAYS };

/** What we store on signup_intents.offer: 'founding' = asked for a founder place, 'free_month' = referred only. */
export type SignupOfferKind = 'none' | 'founding' | 'free_month' | 'month_off_year';
export type SignupOffer = {
  offer: SignupOfferKind;
  trialDays: number;
  /** True when this sign-up should try to claim a founder place (50% off for life) once the trial starts. */
  founder: boolean;
  referred: boolean;
  headline: string;
};

/** What the sign-up page shows. */
export type SignupOfferView = 'trial' | 'founder' | 'referred' | 'founder_referred';

export function offerView(offer: SignupOffer): SignupOfferView {
  if (offer.founder && offer.referred) return 'founder_referred';
  if (offer.founder) return 'founder';
  if (offer.referred) return 'referred';
  return 'trial';
}

function headlineFor(input: { plan: PlanKey; interval: BillingInterval; founder: boolean; trialDays: number }): string {
  const { plan, interval, founder, trialDays } = input;
  const list = PLANS[plan].pence[interval];
  const period = interval === 'month' ? 'a month' : 'a year';
  const price = founder
    ? `${formatPence(Math.round(list / 2))} ${period} for life (founder price)`
    : `${formatPence(list)} ${period}`;
  return `${trialDays} days free, then ${price}. Cancel any time before then and you pay nothing.`;
}

/** Pure. Everyone gets a free trial (card up front). While founder places last (or the count is unknown) the
 *  business also asks for a founder place: 50% off for life, monthly or yearly. A referred friend's trial is 60 days. */
export function chooseSignupOffer(input: { choice: PlanChoice; founding: FoundingStatus; referred: boolean }): SignupOffer {
  const { choice, founding: foundingStatus, referred } = input;
  const founder = foundingStatus.active !== false;
  const trialDays = referred ? REFERRED_TRIAL_DAYS : TRIAL_DAYS;
  return {
    offer: founder ? 'founding' : referred ? 'free_month' : 'none',
    trialDays,
    founder,
    referred,
    headline: headlineFor({ plan: choice.plan, interval: choice.interval, founder, trialDays }),
  };
}

/** server. The Stripe coupon id for the founder discount (50% off for ever, plan products only). Throws when unset. */
export function founderCouponId(): string {
  const id = process.env.STRIPE_COUPON_FOUNDER;
  if (!id) throw new Error('Missing STRIPE_COUPON_FOUNDER');
  return id;
}
