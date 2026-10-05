import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { getAuthUser } from '@/lib/supabase/auth-user';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { ENTITLED_STATUSES, PRO_TIER_PRODUCTS } from '@/lib/data/tenant-products';

type SubRow = { source: string | null; product: string | null; status: string | null };

/** One read per request. Any failure hides the card (the layout must not break). */
const loadReferralGate = cache(async (): Promise<boolean> => {
  try {
    const tenantId = await getTenantIdForCurrentUser();
    if (!tenantId) return false;
    const supabase = await createClient();
    const { user, error: authError } = await getAuthUser();
    if (authError || !user) return false;

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError || profile?.role !== 'admin') return false;

    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('closed_at')
      .eq('id', tenantId)
      .maybeSingle();
    if (tenantError || !tenant || tenant.closed_at) return false;

    const { data, error } = await supabase
      .from('subscriptions')
      .select('source, product, status')
      .eq('tenant_id', tenantId);
    if (error || !data) return false;

    const rows = data as SubRow[];
    const pro = new Set<string>(PRO_TIER_PRODUCTS);
    if (rows.some((row) => row.source === 'manual' || (row.product != null && pro.has(row.product)))) return false;
    const entitled = new Set<string>(ENTITLED_STATUSES);
    const live = rows.some(
      (row) =>
        row.source === 'stripe' &&
        (row.product === 'rounds' || row.product === 'lite') &&
        row.status != null &&
        entitled.has(row.status)
    );
    if (!live) return false;

    // Self-serve businesses always have a code; without one there is no link to show.
    const { data: codeRow, error: codeError } = await createAdminClient()
      .from('tenants')
      .select('referral_code')
      .eq('id', tenantId)
      .maybeSingle();
    if (codeError) return false;
    return typeof codeRow?.referral_code === 'string' && codeRow.referral_code !== '';
  } catch (err) {
    console.error('[referral-nudge]', err instanceof Error ? err.name : 'Error');
    return false;
  }
});

/** True only for an admin of a live self-serve Rounds and/or Lite business (not Pro, manual,
 *  closed or ended) that has a referral code. Reads our own tables only (no Stripe call). */
export async function shouldShowReferral(): Promise<boolean> {
  return loadReferralGate();
}
