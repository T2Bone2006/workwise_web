import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAppUrl } from '@/lib/stripe/client';
import { isBillingInterval, isPlanKey } from '@/lib/billing/plans';

/**
 * "Resume payment" for a signed-in user whose signup is still pending (they
 * closed Checkout, or the account hasn't appeared yet). It does not build a
 * Checkout itself: only startSignup knows the plan, the yearly price, the
 * founding / referral discount and the intent's metadata, so this sends them
 * back to the sign-up page with their plan chosen. startSignup recognises the
 * pending login, expires the old Checkout and opens a fresh one.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${getAppUrl()}/login`);
  }

  const admin = createAdminClient();
  const { data: intent } = await admin
    .from('signup_intents')
    .select('product, billing_interval, status')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (!intent || intent.status === 'provisioned') {
    return NextResponse.redirect(`${getAppUrl()}/dashboard`);
  }

  const plan = isPlanKey(intent.product) ? intent.product : 'rounds';
  const interval = isBillingInterval(intent.billing_interval) ? intent.billing_interval : 'month';
  return NextResponse.redirect(`${getAppUrl()}/signup?plan=${plan}&interval=${interval}&canceled=1`);
}
