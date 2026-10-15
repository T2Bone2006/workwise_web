import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { getAuthUser } from '@/lib/supabase/auth-user';
import { countTeamWorkers } from '@/lib/data/workers';
import { loadProSubscription } from '@/lib/data/worker-allowance';
import type { TenantSettings } from '@/lib/data/settings-types';
import { getStartedFrom, type GetStartedState } from '@/lib/data/get-started-core';

export type { GetStartedState } from '@/lib/data/get-started-core';

const HIDDEN: GetStartedState = {
  show: false,
  expectedWorkers: null,
  steps: { team: { done: false, count: 0 }, customers: { done: false, count: 0 }, jobs: { done: false, count: 0 } },
};

/** Never throws; any error → hidden. */
export async function getGetStartedState(tenantId: string): Promise<GetStartedState> {
  try {
    const supabase = await createClient();
    const { user } = await getAuthUser();
    if (!user) return HIDDEN;

    const [{ data: profile }, row, tenant] = await Promise.all([
      supabase.from('users').select('role').eq('id', user.id).maybeSingle(),
      loadProSubscription(tenantId),
      supabase.from('tenants').select('settings').eq('id', tenantId).maybeSingle(),
    ]);
    const isAdmin = profile?.role === 'admin';
    const stripeBilledPro = Boolean(row && row.source === 'stripe' && row.stripe_subscription_id);
    // No need to count anything for a business that will never see the panel.
    if (!isAdmin || !stripeBilledPro) return HIDDEN;

    const [teamCount, customers, jobs] = await Promise.all([
      countTeamWorkers(tenantId, { includePending: true }),
      supabase.from('customers').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
      supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    ]);
    if (teamCount === null || customers.error || jobs.error) return HIDDEN;

    const settings = (tenant.data?.settings ?? null) as TenantSettings | null;
    return getStartedFrom({
      isAdmin,
      stripeBilledPro,
      teamCount,
      customerCount: customers.count ?? 0,
      jobCount: jobs.count ?? 0,
      expectedWorkers: settings?.onboarding?.expected_workers,
    });
  } catch (err) {
    console.error('[get-started]', err instanceof Error ? err.name : 'Error');
    return HIDDEN;
  }
}
