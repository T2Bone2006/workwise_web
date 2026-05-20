import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import { getTenantIdForCurrentUser, getTenantNameForCurrentUser } from '@/lib/data/tenant';
import { getNetworkNotificationCounts } from '@/lib/data/network';
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

  const [tenantName, admin, tenantId] = await Promise.all([
    getTenantNameForCurrentUser(),
    isAdmin(),
    getTenantIdForCurrentUser(),
  ]);

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
    >
      {children}
    </DashboardShell>
  );
}
