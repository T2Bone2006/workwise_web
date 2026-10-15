import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { ENTITLED_STATUSES } from '@/lib/data/tenant-products';

/** Distinct tenant ids with a rounds subscription in ENTITLED_STATUSES. Same query as generate-visits. */
export async function listRoundsTenantIds(
  admin: SupabaseClient,
): Promise<string[]> {
  const { data, error } = await admin
    .from('subscriptions')
    .select('tenant_id')
    .eq('product', 'rounds')
    .in('status', [...ENTITLED_STATUSES]);

  if (error) {
    console.error('[listRoundsTenantIds]', error.message);
    throw new Error(error.message);
  }

  return [
    ...new Set(
      (data ?? [])
        .map((row) =>
          typeof row.tenant_id === 'string' ? row.tenant_id : null,
        )
        .filter((id): id is string => id != null),
    ),
  ];
}

/** True when the tenant has an entitled Rounds subscription (the bearer-token twin of getTenantProducts().hasRounds). */
export async function tenantHasRounds(admin: SupabaseClient, tenantId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('subscriptions')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('product', 'rounds')
    .in('status', [...ENTITLED_STATUSES])
    .limit(1);
  if (error) {
    console.error('[tenantHasRounds]', error.message);
    throw new Error(error.message);
  }
  return (data ?? []).length > 0;
}
