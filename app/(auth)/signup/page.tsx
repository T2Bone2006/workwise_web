import { Suspense } from 'react';
import { cookies } from 'next/headers';
import type { Metadata } from 'next';
import { SignupForm, type SignupOffers } from '@/components/auth/signup-form';
import { parsePlanChoice } from '@/lib/billing/plans';
import {
  chooseSignupOffer,
  getFoundingStatus,
  offerView,
  lookupReferrer,
  normaliseReferralCode,
  REFERRAL_COOKIE,
} from '@/lib/billing/offers';

export const metadata: Metadata = {
  title: 'Sign up | WorkWise',
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; product?: string; interval?: string; ref?: string; canceled?: string }>;
}) {
  const params = await searchParams;
  const choice = parsePlanChoice(params);
  const founding = await getFoundingStatus();
  const cookieStore = await cookies();
  const code = normaliseReferralCode(params.ref) ?? normaliseReferralCode(cookieStore.get(REFERRAL_COOKIE)?.value);
  const referrer = code ? await lookupReferrer(code) : null;

  // Offer kinds only (no coupon or price ids), so the summary uses the server's rules.
  const offerFor = (plan: 'rounds' | 'lite' | 'both', interval: 'month' | 'year') =>
    offerView(chooseSignupOffer({ choice: { plan, interval }, founding, referred: Boolean(referrer) }));
  const offers: SignupOffers = {
    rounds: { month: offerFor('rounds', 'month'), year: offerFor('rounds', 'year') },
    lite: { month: offerFor('lite', 'month'), year: offerFor('lite', 'year') },
    both: { month: offerFor('both', 'month'), year: offerFor('both', 'year') },
  };

  return (
    <Suspense fallback={null}>
      <SignupForm
        initialChoice={choice}
        founding={{ active: founding.active, placesLeft: founding.placesLeft }}
        referrer={referrer ? { businessName: referrer.businessName, code: referrer.code } : null}
        canceled={Boolean(params.canceled)}
        offers={offers}
      />
    </Suspense>
  );
}
