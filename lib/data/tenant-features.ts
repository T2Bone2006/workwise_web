import { createClient } from '@/lib/supabase/server';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import type { TenantSettings } from '@/lib/data/settings-types';

export type TenantFeatures = {
  pro: boolean;
  widget: boolean;
  autopilot: boolean;
  voice: boolean;
  payments: boolean;
};

const DEFAULT_FEATURES: TenantFeatures = {
  pro: true,
  widget: false,
  autopilot: false,
  voice: false,
  payments: false,
};

export async function getTenantFeatures(): Promise<TenantFeatures> {
  try {
    const tenantId = await getTenantIdForCurrentUser();
    if (!tenantId) return DEFAULT_FEATURES;

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('tenants')
      .select('settings')
      .eq('id', tenantId)
      .maybeSingle();

    const settings = data?.settings as TenantSettings | null | undefined;
    if (error || !settings?.features) return DEFAULT_FEATURES;

    return {
      ...DEFAULT_FEATURES,
      ...settings.features,
    };
  } catch {
    return DEFAULT_FEATURES;
  }
}
