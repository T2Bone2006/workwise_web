import type { SupabaseClient } from '@supabase/supabase-js';

export type RoundsWorker = {
  id: string;
  full_name: string;
  home_postcode: string | null;
  home_lat: number | null;
  home_lng: number | null;
  expo_push_token: string | null;
};

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** The tenant's platform_solo worker (created by provisioning); null for Pro tenants. */
export async function getSoloWorkerForTenant(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<RoundsWorker | null> {
  const { data, error } = await supabase
    .from('workers')
    .select('id, full_name, home_postcode, home_lat, home_lng, expo_push_token')
    .eq('primary_tenant_id', tenantId)
    .eq('worker_type', 'platform_solo')
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[getSoloWorkerForTenant]', error);
    return null;
  }
  if (!data) return null;

  return {
    id: String(data.id),
    full_name: typeof data.full_name === 'string' ? data.full_name : '',
    home_postcode: typeof data.home_postcode === 'string' ? data.home_postcode : null,
    home_lat: asFiniteNumber(data.home_lat),
    home_lng: asFiniteNumber(data.home_lng),
    expo_push_token: typeof data.expo_push_token === 'string' ? data.expo_push_token : null,
  };
}
