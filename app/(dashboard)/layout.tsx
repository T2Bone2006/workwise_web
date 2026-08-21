import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import { getTenantIdForCurrentUser, getTenantNameForCurrentUser } from '@/lib/data/tenant';
import { getTenantFeatures } from '@/lib/data/tenant-features';
import { getNetworkNotificationCounts } from '@/lib/data/network';
import { WORKER_WEB_LOGIN_ERROR_PARAM } from '@/lib/auth/worker-web-access';
import { isAdmin } from '@/lib/utils/admin';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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

  const [tenantName, admin, tenantId, features] = await Promise.all([
    getTenantNameForCurrentUser(),
    isAdmin(),
    getTenantIdForCurrentUser(),
    getTenantFeatures(),
  ]);

  // TODO: route protection — add per-page checks instead (layout has no pathname access in this codebase)

  const networkCounts = tenantId ? await getNetworkNotificationCounts(tenantId) : null;
  const networkBadge = networkCounts
    ? networkCounts.pendingConnections + networkCounts.inboxJobs
    : undefined;

  return (
    <DashboardShell
      tenantName={tenantName}
      userEmail={user.email ?? undefined}
      isAdmin={admin}
      networkBadge={networkBadge}
      features={features}
    >
      {children}
    </DashboardShell>
  );
}
