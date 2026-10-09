import { normaliseReferralCode } from '@/lib/billing/offers';
import { PRO_PLANS, clampWorkers, isProTier, recommendTier, type ProChoice } from '@/lib/billing/pro-plans';

export type ProSignupParams = {
  choice: ProChoice;
  /** The slider's number (1–999). */
  workers: number;
  canceled: boolean;
  ref: string | null;
};

/**
 * Reads the Pro sign-up page's URL (all optional, all untrusted).
 * - interval: 'year' or month (anything else).
 * - workers: a whole number 1–999 when valid; otherwise treated as missing.
 * - tier: the one asked for; if unknown, the cheapest for `workers` when that was given, else growth.
 * - workers missing: the tier's included count (10 / 35 / 70).
 */
export function parseProSignupParams(raw: {
  tier?: string;
  plan?: string;
  interval?: string;
  workers?: string;
  ref?: string;
  canceled?: string;
}): ProSignupParams {
  const interval = raw.interval === 'year' ? 'year' : 'month';
  const asNumber = raw.workers != null && raw.workers !== '' ? Number(raw.workers) : NaN;
  const givenWorkers = Number.isFinite(asNumber) && asNumber >= 1 ? clampWorkers(asNumber) : null;

  const asked = isProTier(raw.tier) ? raw.tier : isProTier(raw.plan) ? raw.plan : null;
  const tier = asked ?? (givenWorkers != null ? recommendTier(givenWorkers, interval).tier : 'growth');
  const workers = givenWorkers ?? PRO_PLANS[tier].included;

  return {
    choice: { tier, interval },
    workers,
    canceled: Boolean(raw.canceled),
    ref: normaliseReferralCode(raw.ref),
  };
}
