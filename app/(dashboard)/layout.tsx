import { createClient } from '@/lib/supabase/server';
import { getAuthUser } from '@/lib/supabase/auth-user';
import { redirect } from 'next/navigation';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import { getTenantIdForCurrentUser, getTenantNameForCurrentUser } from '@/lib/data/tenant';
import { getTenantFeatures } from '@/lib/data/tenant-features';
import { getUnreadThreadCount } from '@/lib/data/messaging/threads';
import { getNetworkNotificationCounts } from '@/lib/data/network';
import { addLiteInterval, shouldShowAddLite } from '@/lib/data/add-lite-nudge';
import { shouldShowReferral } from '@/lib/data/referral-nudge';
import { getTenantProducts, PRO_TIER_PRODUCTS } from '@/lib/data/tenant-products';
import { WORKER_WEB_LOGIN_ERROR_PARAM } from '@/lib/auth/worker-web-access';
import { isAdmin } from '@/lib/utils/admin';
import { getViewAsState, recoverAbandonedViewAsIfNeeded } from '@/lib/impersonation/session';

/** Amber banner only for a live self-serve row that is past_due. Pro and managed businesses never see it. */
async function paymentOverdue(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string | null,
  isPro: boolean,
): Promise<boolean> {
  if (!tenantId || isPro) return false;
  try {
    const [{ data, error }, { data: tenant, error: tenantError }] = await Promise.all([
      supabase.from('subscriptions').select('status, source, product').eq('tenant_id', tenantId),
      supabase.from('tenants').select('stripe_customer_id').eq('id', tenantId).maybeSingle(),
    ]);
    if (error || tenantError || !data || !tenant?.stripe_customer_id) return false;
    const pro = new Set<string>(PRO_TIER_PRODUCTS);
    if (data.some((row) => row.source === 'manual' || (row.product != null && pro.has(row.product)))) return false;
    return data.some(
      (row) => row.source === 'stripe' && row.status === 'past_due' && (row.product === 'rounds' || row.product === 'lite'),
    );
  } catch (err) {
    console.error('[overdue]', err instanceof Error ? err.name : 'Error');
    return false;
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { user } = await getAuthUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle<{ role: string | null }>();

  if (profile?.role === 'worker') {
    await supabase.auth.signOut();
    redirect(`/login?error=${WORKER_WEB_LOGIN_ERROR_PARAM}`);
  }

  if (profile?.role === 'customer_portal') {
    redirect('/portal');
  }

  await recoverAbandonedViewAsIfNeeded();

  const [tenantName, admin, tenantId, features, viewAs, products, showAddLite, showReferral] = await Promise.all([
    getTenantNameForCurrentUser(),
    isAdmin(),
    getTenantIdForCurrentUser(),
    getTenantFeatures(),
    getViewAsState(),
    getTenantProducts(),
    shouldShowAddLite(),
    shouldShowReferral(),
  ]);
  const addLiteYearly = showAddLite && (await addLiteInterval()) === 'year';

  // TODO: route protection — add per-page checks instead (layout has no pathname access in this codebase)

  const [networkCounts, messagesBadge] = await Promise.all([
    tenantId ? getNetworkNotificationCounts(tenantId) : Promise.resolve(null),
    tenantId && products.hasRounds
      ? getUnreadThreadCount(supabase, tenantId)
      : Promise.resolve(undefined),
  ]);
  const networkBadge = networkCounts
    ? networkCounts.pendingConnections + networkCounts.inboxJobs
    : undefined;
  const overdue = await paymentOverdue(supabase, tenantId, products.isPro);

  return (
    <DashboardShell
      tenantName={tenantName}
      userEmail={user.email ?? undefined}
      isAdmin={admin}
      networkBadge={networkBadge}
      messagesBadge={messagesBadge}
      features={features}
      viewAsTenantName={viewAs.active ? viewAs.tenantName : null}
      look={products.isPro ? 'classic' : 'new'}
      showAddLite={showAddLite}
      addLiteYearly={addLiteYearly}
      showReferral={showReferral}
      overdue={overdue}
    >
      {children}
    </DashboardShell>
  );
}
