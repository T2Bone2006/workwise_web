import 'server-only';

import { lookupReferrer, normaliseReferralCode, type Referrer } from '@/lib/billing/offers';
import { lookupPartner, type PartnerCode } from '@/lib/billing/partner-referrals';
import { normaliseSignupCode } from '@/lib/billing/partner-share';

export type SignupReferral =
  | { kind: 'customer'; referrer: Referrer }
  | { kind: 'partner'; partner: PartnerCode };

/**
 * A typed code is checked as a customer referral first, then as a partner code.
 * A customer code pays that customer a free month on their own bill. A partner code
 * gives the new trader the same offer and is tracked for the 10%.
 */
export async function resolveSignupReferral(code: string): Promise<SignupReferral | null> {
  const normalised = normaliseSignupCode(code);
  if (!normalised) return null;
  if (normaliseReferralCode(normalised)) {
    const referrer = await lookupReferrer(normalised);
    if (referrer) return { kind: 'customer', referrer };
  }
  const partner = await lookupPartner(normalised);
  if (partner) return { kind: 'partner', partner };
  return null;
}

/**
 * A non-empty typed code that we don't know is an error, so a mistype does not
 * silently fall through to the cookie or to full price. An empty box uses the cookie.
 */
export async function referralFromSources(input: {
  typed: string;
  cookie: string | null;
}): Promise<{ error: 'unknown' } | { match: SignupReferral | null }> {
  const typed = input.typed.trim();
  if (typed) {
    const code = normaliseSignupCode(typed);
    if (!code) return { error: 'unknown' };
    const match = await resolveSignupReferral(code);
    if (!match) return { error: 'unknown' };
    return { match };
  }
  const code = normaliseSignupCode(input.cookie);
  if (!code) return { match: null };
  const match = await resolveSignupReferral(code);
  return { match };
}
