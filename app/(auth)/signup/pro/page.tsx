import { Suspense } from 'react';
import { cookies } from 'next/headers';
import type { Metadata } from 'next';
import { ProSignupForm } from '@/components/auth/pro-signup-form';
import { lookupReferrer, normaliseReferralCode, REFERRAL_COOKIE } from '@/lib/billing/offers';
import { parseProSignupParams } from '@/lib/billing/pro-signup-params';

export const metadata: Metadata = {
  title: 'Sign up for Pro | WorkWise',
};

export default async function ProSignupPage({
  searchParams,
}: {
  searchParams: Promise<{
    tier?: string;
    plan?: string;
    interval?: string;
    workers?: string;
    ref?: string;
    canceled?: string;
  }>;
}) {
  const params = parseProSignupParams(await searchParams);
  const cookieStore = await cookies();
  const code = params.ref ?? normaliseReferralCode(cookieStore.get(REFERRAL_COOKIE)?.value);
  const referrer = code ? await lookupReferrer(code) : null;

  return (
    <Suspense fallback={null}>
      <ProSignupForm
        initialChoice={params.choice}
        initialWorkers={params.workers}
        referrer={referrer ? { businessName: referrer.businessName, code: referrer.code } : null}
        canceled={params.canceled}
      />
    </Suspense>
  );
}
