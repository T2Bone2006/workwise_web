import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export type SignupStatus = 'unauthenticated' | 'pending' | 'provisioned' | 'unknown';

/**
 * Polled by /signup/complete while the Stripe webhook provisions the account.
 * "provisioned" means the users row exists for this login, which is exactly
 * the condition the dashboard layout needs.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ status: 'unauthenticated' satisfies SignupStatus });
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.tenant_id) {
    return NextResponse.json({ status: 'provisioned' satisfies SignupStatus });
  }

  const { data: intent } = await admin
    .from('signup_intents')
    .select('status')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  return NextResponse.json({
    status: (intent ? 'pending' : 'unknown') satisfies SignupStatus,
  });
}
