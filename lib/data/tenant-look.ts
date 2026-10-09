import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import type { TenantSettings } from '@/lib/data/settings-types';
import { lookFromSettings } from '@/lib/data/tenant-look-core';
import type { TenantProducts } from '@/lib/data/tenant-products';
import type { Look } from '@/components/look/use-look';

export const getTenantLook = cache(async (products: TenantProducts): Promise<Look> => {
  if (!products.isPro) return 'new';
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return 'classic';
  const supabase = await createClient();
  const { data } = await supabase.from('tenants').select('settings').eq('id', tenantId).maybeSingle();
  return lookFromSettings(true, (data?.settings ?? null) as TenantSettings | null);
});
