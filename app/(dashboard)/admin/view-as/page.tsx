import { redirect } from 'next/navigation';
import { isAdmin } from '@/lib/utils/admin';
import { listTenantsForViewAs } from '@/lib/actions/impersonation';
import { getViewAsState } from '@/lib/impersonation/session';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { ViewAsTenantList } from '@/components/admin/view-as-tenant-list';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default async function ViewAsTenantPage() {
  const admin = await isAdmin();
  if (!admin) {
    redirect('/dashboard');
  }

  const viewAs = await getViewAsState();
  const { tenants, error } = await listTenantsForViewAs();

  return (
    <div className="space-y-6">
      <PageGradientHeader
        title="View as tenant"
        subtitle="Open a client’s dashboard with your admin account. Their password is not required. You can make changes as that client."
      />

      {viewAs.active && (
        <Card className="border-amber-500/40 bg-amber-500/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Currently viewing</CardTitle>
            <CardDescription>
              You are viewing{' '}
              <span className="font-medium text-foreground">
                {viewAs.tenantName}
              </span>
              . Use the banner Exit button, or pick another tenant below.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Clients</CardTitle>
          <CardDescription>
            Select a tenant to load their jobs, workers, and monitor view.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : (
            <ViewAsTenantList tenants={tenants} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
