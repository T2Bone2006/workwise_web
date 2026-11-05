import { createAdminClient } from '@/lib/supabase/admin';
import { getStripe } from '@/lib/stripe/client';
import { tallyAdSignups, type AdResult } from '@/lib/billing/ad-source';

export type AdSignupResults = { rows: AdResult[]; error: boolean };

/** Sign-ups that came from a tagged ad: read from Stripe customers, with "paid" checked against the sign-up record. */
export async function listAdSignups(): Promise<AdSignupResults> {
  try {
    const customers = await getStripe()
      .customers.search({ query: "metadata['ad_source']:'facebook'", limit: 100 })
      .autoPagingToArray({ limit: 1000 });

    const signups = customers.map((customer) => ({
      adContent: customer.metadata.ad_content ?? null,
      signupIntentId: customer.metadata.signup_intent_id ?? null,
    }));
    const intentIds = signups.flatMap((s) => (s.signupIntentId ? [s.signupIntentId] : []));

    let paid = new Set<string>();
    if (intentIds.length > 0) {
      const { data, error } = await createAdminClient()
        .from('signup_intents')
        .select('id')
        .in('id', intentIds)
        .eq('status', 'provisioned');
      if (error) throw new Error('signup_intents lookup failed');
      paid = new Set((data ?? []).map((row) => row.id as string));
    }

    return { rows: tallyAdSignups(signups, paid), error: false };
  } catch (err) {
    console.error(`[listAdSignups] ${err instanceof Error ? err.name : 'Error'}`);
    return { rows: [], error: true };
  }
}
