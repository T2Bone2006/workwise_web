import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { getAuthUser } from '@/lib/supabase/auth-user';

const FALLBACK_TENANT_NAME = 'WorkWise';

/**
 * Gets the tenant/company name for the currently authenticated user.
 * Flow: auth user → users.tenant_id → tenants.name.
 * Returns fallback "WorkWise" if user is missing, not linked to a tenant, or tenant has no name.
 */
export const getTenantNameForCurrentUser = cache(async (): Promise<string> => {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) {
    return FALLBACK_TENANT_NAME;
  }

  const supabase = await createClient();
  const { data: tenantRow } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .maybeSingle();

  const name = tenantRow?.name?.trim();
  return name || FALLBACK_TENANT_NAME;
});

/**
 * Gets the tenant_id for the currently authenticated user.
 * Returns null if user is missing or not linked to a tenant.
 * Never throws - catches errors and returns null so the page can show a fallback.
 */
export const getTenantIdForCurrentUser = cache(async (): Promise<string | null> => {
  try {
    const { user, error: authError } = await getAuthUser();

    if (authError) {
      console.error('[getTenantIdForCurrentUser] Auth error:', authError);
      return null;
    }
    if (!user?.id) {
      return null;
    }

    const supabase = await createClient();
    const { data: userRow, error: userError } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .maybeSingle();

    if (userError) {
      console.error('[getTenantIdForCurrentUser] Users table error:', userError);
      return null;
    }

    return userRow?.tenant_id ?? null;
  } catch (err) {
    console.error('[getTenantIdForCurrentUser] Unexpected error:', err);
    return null;
  }
});
