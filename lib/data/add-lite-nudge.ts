import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { getAuthUser } from '@/lib/supabase/auth-user';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { ENTITLED_STATUSES, PRO_TIER_PRODUCTS } from '@/lib/data/tenant-products';

type SubRow = {
  source: string | null;
  product: string | null;
  status: string | null;
  cancel_at_period_end: boolean | null;
  billing_interval: string | null;
};

type Gate = { show: false } | { show: true; yearly: boolean };

/** One read per request. Any failure hides the nudge (the layout must not break). */
const loadAddLite = cache(async (): Promise<Gate> => {
  try {
    const tenantId = await getTenantIdForCurrentUser();
    if (!tenantId) return { show: false };
    const supabase = await createClient();
    const { user, error: authError } = await getAuthUser();
    if (authError || !user) return { show: false };

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError || profile?.role !== 'admin') return { show: false };

    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('closed_at')
      .eq('id', tenantId)
      .maybeSingle();
    if (tenantError || !tenant || tenant.closed_at) return { show: false };

    const { data, error } = await supabase
      .from('subscriptions')
      .select('source, product, status, cancel_at_period_end, billing_interval')
      .eq('tenant_id', tenantId);
    if (error || !data) return { show: false };

    const rows = data as SubRow[];
    const pro = new Set<string>(PRO_TIER_PRODUCTS);
    if (rows.some((row) => row.source === 'manual' || (row.product != null && pro.has(row.product)))) {
      return { show: false };
    }
    const entitled = new Set<string>(ENTITLED_STATUSES);
    const liveLite = rows.some((row) => row.product === 'lite' && row.status != null && entitled.has(row.status));
    if (liveLite) return { show: false };

    const rounds = rows.find(
      (row) =>
        row.source === 'stripe' &&
        row.product === 'rounds' &&
        row.status === 'active' &&
        row.cancel_at_period_end !== true
    );
    if (!rounds) return { show: false };
    return { show: true, yearly: rounds.billing_interval === 'year' };
  } catch (err) {
    console.error('[add-lite]', err instanceof Error ? err.name : 'Error');
    return { show: false };
  }
});

/** True only when: the user is an admin; the business has a live Stripe 'rounds' row
 *  (status 'active', cancel_at_period_end = false); no live 'lite' row; no manual or
 *  Pro-tier row; not closed. Reads our subscriptions table only (no Stripe call). */
export async function shouldShowAddLite(): Promise<boolean> {
  return (await loadAddLite()).show;
}

/** Yearly only when the nudge is showing and the live Rounds row is billed yearly. */
export async function addLiteInterval(): Promise<'month' | 'year'> {
  const gate = await loadAddLite();
  return gate.show && gate.yearly ? 'year' : 'month';
}
