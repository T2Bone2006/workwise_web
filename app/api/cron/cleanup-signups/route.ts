import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAuthorisedCronRequest } from '@/lib/cron/auth';
import { sweepStuckReferralRewards } from '@/lib/billing/referrals';

const ABANDON_AFTER_DAYS = 7;

/**
 * Daily: signups that never reached Checkout completion are marked abandoned
 * and their orphan auth user deleted, so the email can be reused. Nothing
 * else references those users (no tenant was ever created).
 */
export async function GET(request: Request) {
  if (!isAuthorisedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - ABANDON_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: pending, error } = await admin
    .from('signup_intents')
    .select('id, auth_user_id, created_at, last_checkout_at')
    .eq('status', 'pending');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const stale = (pending ?? []).filter((intent) => {
    const stamp = intent.last_checkout_at ?? intent.created_at;
    return typeof stamp === 'string' && stamp < cutoff;
  });

  let abandoned = 0;
  for (const intent of stale ?? []) {
    // Belt and braces: never delete a login that somehow got a tenant.
    const { data: profile } = await admin.from('users').select('tenant_id').eq('id', intent.auth_user_id).maybeSingle();
    if (profile?.tenant_id) continue;

    await admin.from('signup_intents').update({ status: 'abandoned' }).eq('id', intent.id);
    const { error: deleteError } = await admin.auth.admin.deleteUser(intent.auth_user_id);
    if (deleteError) {
      console.warn(`[cleanup-signups] could not delete auth user ${intent.auth_user_id}: ${deleteError.message}`);
    }
    abandoned += 1;
  }

  const referralRewards = await sweepStuckReferralRewards();
  return NextResponse.json({ abandoned, referralRewards });
}
