import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import { getTenantNameForCurrentUser } from '@/lib/data/tenant';
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

  const [tenantName, admin] = await Promise.all([
    getTenantNameForCurrentUser(),
    isAdmin(),
  ]);

  return (
    <DashboardShell
      tenantName={tenantName}
      userEmail={user.email ?? undefined}
      isAdmin={admin}
    >
      {children}
    </DashboardShell>
  );
}
