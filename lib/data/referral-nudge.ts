import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { getAuthUser } from '@/lib/supabase/auth-user';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { ENTITLED_STATUSES, PRO_TIER_PRODUCTS } from '@/lib/data/tenant-products';

type SubRow = { source: string | null; product: string | null; status: string | null };

export type ReferralKind = 'rounds_lite' | 'pro';

/** One read per request. Any failure hides the card (the layout must not break). */
/** Pure: which referral page these subscription rows allow. */
export function kindFromRows(rows: SubRow[]): ReferralKind | null {
  if (rows.some((row) => row.source === 'manual')) return null;
  const pro = new Set<string>(PRO_TIER_PRODUCTS);
  const entitled = new Set<string>(ENTITLED_STATUSES);
  const proRows = rows.filter((row) => row.product != null && pro.has(row.product));
  if (proRows.length > 0) {
    if (proRows.some((row) => row.source !== 'stripe')) return null;
    const live = proRows.some((row) => row.status != null && entitled.has(row.status));
    return live ? 'pro' : null;
  }
  const live = rows.some(
    (row) =>
      row.source === 'stripe' &&
      (row.product === 'rounds' || row.product === 'lite') &&
      row.status != null &&
      entitled.has(row.status)
  );
  return live ? 'rounds_lite' : null;
}

const loadReferralKind = cache(async (): Promise<ReferralKind | null> => {
  try {
    const tenantId = await getTenantIdForCurrentUser();
    if (!tenantId) return null;
    const supabase = await createClient();
    const { user, error: authError } = await getAuthUser();
    if (authError || !user) return null;

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError || profile?.role !== 'admin') return null;

    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('closed_at')
      .eq('id', tenantId)
      .maybeSingle();
    if (tenantError || !tenant || tenant.closed_at) return null;

    const { data, error } = await supabase
      .from('subscriptions')
      .select('source, product, status')
      .eq('tenant_id', tenantId);
    if (error || !data) return null;

    const kind = kindFromRows(data as SubRow[]);
    if (!kind) return null;

    // Self-serve businesses always have a code; without one there is no link to show.
    const { data: codeRow, error: codeError } = await createAdminClient()
      .from('tenants')
      .select('referral_code')
      .eq('id', tenantId)
      .maybeSingle();
    if (codeError) return null;
    return typeof codeRow?.referral_code === 'string' && codeRow.referral_code !== '' ? kind : null;
  } catch (err) {
    console.error('[referral-nudge]', err instanceof Error ? err.name : 'Error');
    return null;
  }
});

/**
 * 'rounds_lite' for an admin of a live self-serve Rounds and/or Lite business (no manual row, no Pro row, not closed
 * or ended) that has a referral code. 'pro' for an admin of a business with no manual row, only Stripe-billed Pro
 * rows and a live (entitled) one, not closed, with a code. Otherwise null. Reads our own tables only (no Stripe call).
 */
export async function referralKind(): Promise<ReferralKind | null> {
  return loadReferralKind();
}

/** True only for the Rounds/Lite kind: same meaning as before Pro had a referral page. */
export async function shouldShowReferral(): Promise<boolean> {
  return (await loadReferralKind()) === 'rounds_lite';
}
