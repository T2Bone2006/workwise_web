import { Suspense } from 'react';
import { cookies } from 'next/headers';
import type { Metadata } from 'next';
import { SignupForm, type SignupOffers } from '@/components/auth/signup-form';
import { parsePlanChoice } from '@/lib/billing/plans';
import { chooseSignupOffer, getFoundingStatus, offerView, REFERRAL_COOKIE } from '@/lib/billing/offers';
import { referralFromSources } from '@/lib/billing/signup-referral';

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
  const typed = params.ref ?? '';
  const found = await referralFromSources({
    typed,
    cookie: cookieStore.get(REFERRAL_COOKIE)?.value ?? null,
  });
  const match = 'error' in found ? null : found.match;
  const referrer = match?.kind === 'customer' ? match.referrer : match?.kind === 'partner' ? { businessName: match.partner.name, code: match.partner.code } : null;
  const enteredCode = referrer?.code || typed.trim();

  // Offer kinds only (no coupon or price ids), so the summary uses the server's rules.
  const offerFor = (plan: 'rounds' | 'lite' | 'both', interval: 'month' | 'year') =>
    offerView(chooseSignupOffer({ choice: { plan, interval }, founding, referred: Boolean(match) }));
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
        enteredCode={enteredCode}
        codeError={'error' in found ? "That referral code isn't recognised." : null}
        canceled={Boolean(params.canceled)}
        offers={offers}
      />
    </Suspense>
  );
}
