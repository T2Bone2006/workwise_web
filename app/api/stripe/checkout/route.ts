import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAppUrl } from '@/lib/stripe/client';
import { isBillingInterval, isPlanKey } from '@/lib/billing/plans';
import { isProTier } from '@/lib/billing/pro-plans';
import { resumePendingCheckout } from '@/lib/billing/resume-checkout';

/**
 * "Resume payment" for a signed-in user whose signup is still pending.
 * Opens a fresh Checkout for the plan already on the signup. If there is no
 * Stripe customer yet, sends them back to the sign-up form to finish it.
 */
export async function GET() {
  const appUrl = getAppUrl();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${appUrl}/login`);
  }

  try {
    const result = await resumePendingCheckout(user.id);
    if (result.kind === 'url') return NextResponse.redirect(result.url);
    if (result.kind === 'signup') return NextResponse.redirect(await signupFormUrl(user.id, appUrl));
  } catch (err) {
    console.error('[resume checkout]', err instanceof Error ? err.name : 'Error');
    return NextResponse.redirect(await signupFormUrl(user.id, appUrl));
  }

  return NextResponse.redirect(`${appUrl}/dashboard`);
}

/** The sign-up form, with the stored plan selected, so they can carry on by hand. */
async function signupFormUrl(authUserId: string, appUrl: string): Promise<string> {
  const admin = createAdminClient();
  const { data: intent } = await admin
    .from('signup_intents')
    .select('product, billing_interval, expected_workers')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (intent && isProTier(intent.product)) {
    const params = new URLSearchParams({
      tier: intent.product,
      interval: isBillingInterval(intent.billing_interval) ? intent.billing_interval : 'month',
      canceled: '1',
    });
    if (typeof intent.expected_workers === 'number') params.set('workers', String(intent.expected_workers));
    return `${appUrl}/signup/pro?${params.toString()}`;
  }

  const plan = isPlanKey(intent?.product) ? intent.product : 'rounds';
  const interval = isBillingInterval(intent?.billing_interval) ? intent.billing_interval : 'month';
  return `${appUrl}/signup?plan=${plan}&interval=${interval}&canceled=1`;
}
