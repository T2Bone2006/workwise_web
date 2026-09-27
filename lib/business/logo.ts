import type { SupabaseClient } from '@supabase/supabase-js';
import type { TenantSettings, TenantSettingsCompany } from '@/lib/data/settings-types';

export const BUSINESS_ASSETS_BUCKET = 'business-assets';

export function logoObjectPath(tenantId: string, ext: 'png' | 'jpg'): string {
  return `${tenantId}/logo-${Date.now()}.${ext}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Path must sit in this tenant's folder and be a png/jpg/jpeg. */
function isTenantLogoPath(tenantId: string, path: string): boolean {
  const prefix = `${tenantId}/`;
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  if (rest.length === 0 || rest.includes('/') || rest.includes('\\') || rest.includes('..')) {
    return false;
  }
  const lower = rest.toLowerCase();
  return lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg');
}

/**
 * Validates the path is inside the tenant's folder, derives the public URL,
 * writes settings.company.logo_url + logo_path. Does NOT delete old files
 * (issued invoices point at them).
 */
export async function setCompanyLogoCore(
  supabase: SupabaseClient,
  tenantId: string,
  path: string | null,
): Promise<{ success: true; logoUrl: string | null } | { success: false; error: string }> {
  let logoUrl: string | null = null;

  if (path !== null) {
    if (!isTenantLogoPath(tenantId, path)) {
      return { success: false, error: "That file isn't in your business folder" };
    }
    logoUrl = supabase.storage.from(BUSINESS_ASSETS_BUCKET).getPublicUrl(path).data.publicUrl;
  }

  const { data: tenant, error: loadError } = await supabase
    .from('tenants')
    .select('settings')
    .eq('id', tenantId)
    .maybeSingle();

  if (loadError) {
    console.error('setCompanyLogoCore load failed', loadError);
    return { success: false, error: 'Could not save the logo.' };
  }

  const currentSettings: TenantSettings = isPlainObject(tenant?.settings)
    ? (tenant.settings as TenantSettings)
    : {};
  const company: TenantSettingsCompany = { ...(currentSettings.company ?? {}) };

  if (path === null) {
    delete company.logo_url;
    delete company.logo_path;
  } else {
    company.logo_url = logoUrl ?? undefined;
    company.logo_path = path;
  }

  const { error } = await supabase
    .from('tenants')
    .update({ settings: { ...currentSettings, company } })
    .eq('id', tenantId);

  if (error) {
    console.error('setCompanyLogoCore update failed', error);
    return { success: false, error: 'Could not save the logo.' };
  }

  return { success: true, logoUrl };
}
