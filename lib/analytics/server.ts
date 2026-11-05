import { analytics } from '@heycatch/sdk';
import { createAdminClient } from '@/lib/supabase/admin';

// HeyCatch, server side. Module scope, once per server bundle.
analytics.init({ projectKey: 'hck_pk_2TVWxNLgbjfVlZOurqdrd8608P_oJMpa' });

/**
 * A paid sign-up just finished (called from the Stripe webhook after the business is provisioned).
 * The user id is the same auth user id the browser passes to setIdentity, which is what joins the two.
 * Best effort: analytics must never fail or slow a payment, so every error is swallowed.
 */
export async function trackSignupPaid(intentId: string): Promise<void> {
  try {
    const { data: intent } = await createAdminClient()
      .from('signup_intents')
      .select('auth_user_id, email, product, billing_interval')
      .eq('id', intentId)
      .maybeSingle<{
        auth_user_id: string | null;
        email: string | null;
        product: string | null;
        billing_interval: string | null;
      }>();
    if (!intent?.auth_user_id) return;

    const userId = intent.auth_user_id;
    const plan = intent.product ?? null;
    await analytics.setIdentity(userId, { ...(intent.email ? { email: intent.email } : {}), ...(plan ? { plan } : {}) });
    await analytics.trackEvent('signup_completed', { plan, interval: intent.billing_interval ?? null }, { userId });
    await analytics.trackEvent('subscription_started', { plan, interval: intent.billing_interval ?? null }, { userId });
  } catch (err) {
    console.warn('[analytics] signup tracking failed (non-fatal)', err instanceof Error ? err.name : 'Error');
  }
}
