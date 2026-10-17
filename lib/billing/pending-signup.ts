import { createAdminClient } from '@/lib/supabase/admin';

/** Where a signed-in person with an unpaid signup should land: a prompt to finish payment. */
export const UNPAID_SIGNUP_PATH = '/signup/complete?canceled=1';

/** True when this login was created at checkout and Stripe has not provisioned a business yet. */
export async function hasPendingSignup(authUserId: string): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('signup_intents')
      .select('id')
      .eq('auth_user_id', authUserId)
      .eq('status', 'pending')
      .maybeSingle();
    if (error) return false;
    return Boolean(data);
  } catch {
    return false;
  }
}
