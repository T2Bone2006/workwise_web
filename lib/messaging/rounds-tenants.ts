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
