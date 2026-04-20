import { createClient } from '@/lib/supabase/server';

const FALLBACK_TENANT_NAME = 'WorkWise';

/**
 * Gets the tenant/company name for the currently authenticated user.
 * Flow: auth user → users.tenant_id → tenants.name.
 * Returns fallback "WorkWise" if user is missing, not linked to a tenant, or tenant has no name.
 */
export async function getTenantNameForCurrentUser(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id) {
    return FALLBACK_TENANT_NAME;
  }

  const { data: userRow } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .maybeSingle();

  const tenantId = userRow?.tenant_id;
  if (!tenantId) {
    return FALLBACK_TENANT_NAME;
  }

  const { data: tenantRow } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .maybeSingle();

  const name = tenantRow?.name?.trim();
  return name || FALLBACK_TENANT_NAME;
}

/**
 * Gets the tenant_id for the currently authenticated user.
 * Returns null if user is missing or not linked to a tenant.
 * Never throws - catches errors and returns null so the page can show a fallback.
 */
export async function getTenantIdForCurrentUser(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    console.log('[getTenantIdForCurrentUser] Auth user:', user?.id ?? null, authError?.message ?? 'ok');

    if (authError) {
      console.error('[getTenantIdForCurrentUser] Auth error:', authError);
      return null;
    }
    if (!user?.id) {
      console.log('[getTenantIdForCurrentUser] No user id');
      return null;
    }

    const { data: userRow, error: userError } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .maybeSingle();

    if (userError) {
      console.error('[getTenantIdForCurrentUser] Users table error:', userError);
      return null;
    }

    const tenantId = userRow?.tenant_id ?? null;
    console.log('[getTenantIdForCurrentUser] Tenant ID:', tenantId);
    return tenantId;
  } catch (err) {
    console.error('[getTenantIdForCurrentUser] Unexpected error:', err);
    return null;
  }
}
