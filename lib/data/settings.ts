import { createClient } from '@/lib/supabase/server';
import type {
  TenantSettings,
  TenantForSettings,
  UserForSettings,
  SettingsPageData,
} from './settings-types';

export type {
  IndustryOption,
  TenantSettingsCompany,
  PricingMargins,
  IntegrationsSettings,
  NotificationsSettings,
  TenantForSettings,
  UserForSettings,
  SettingsPageData,
} from './settings-types';

export { getDefaultNotifications } from './settings-types';

/**
 * Fetches all data needed for the Settings page: tenant (with settings),
 * current user, job count, worker count.
 */
export async function getSettingsPageData(): Promise<SettingsPageData> {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser?.id) {
    return {
      tenant: null,
      user: null,
      tenantId: null,
      totalJobsCount: 0,
      totalWorkersCount: 0,
    };
  }

  const { data: userRow } = await supabase
    .from('users')
    .select('id, email, full_name, role, avatar_url, tenant_id, created_at')
    .eq('id', authUser.id)
    .maybeSingle();

  const tenantId = userRow?.tenant_id ?? null;
  if (!tenantId) {
    return {
      tenant: null,
      user: userRow
        ? {
            id: userRow.id,
            email: userRow.email ?? '',
            full_name: userRow.full_name ?? null,
            role: userRow.role ?? 'owner',
            avatar_url: userRow.avatar_url ?? null,
            tenant_id: null,
            created_at: userRow.created_at ?? '',
          }
        : null,
      tenantId: null,
      totalJobsCount: 0,
      totalWorkersCount: 0,
    };
  }

  const { data: tenantRow } = await supabase
    .from('tenants')
    .select('id, name, slug, industry, settings, subscription_status, subscription_tier, created_at')
    .eq('id', tenantId)
    .maybeSingle();

  const [{ count: jobsCount }, { count: workersCount }] = await Promise.all([
    supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    supabase.from('workers').select('id', { count: 'exact', head: true }).eq('primary_tenant_id', tenantId),
  ]);

  const tenant: TenantForSettings | null = tenantRow
    ? {
        id: tenantRow.id,
        name: tenantRow.name ?? '',
        slug: tenantRow.slug ?? '',
        industry: tenantRow.industry ?? null,
        settings: (tenantRow.settings as TenantSettings) ?? {},
        subscription_status: tenantRow.subscription_status ?? null,
        subscription_tier: tenantRow.subscription_tier ?? null,
        created_at: tenantRow.created_at ?? '',
      }
    : null;

  const user: UserForSettings | null = userRow
    ? {
        id: userRow.id,
        email: userRow.email ?? '',
        full_name: userRow.full_name ?? null,
        role: userRow.role ?? 'owner',
        avatar_url: userRow.avatar_url ?? null,
        tenant_id: userRow.tenant_id ?? null,
        created_at: userRow.created_at ?? '',
      }
    : null;

  return {
    tenant,
    user,
    tenantId,
    totalJobsCount: jobsCount ?? 0,
    totalWorkersCount: workersCount ?? 0,
  };
}
