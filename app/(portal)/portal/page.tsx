import { Lock } from 'lucide-react';
import { redirect } from 'next/navigation';
import { PortalHome } from '@/components/portal/portal-overview';
import { TenantSelector } from '@/components/portal/tenant-selector';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { EmptyState } from '@/components/look/empty-state';
import { getPortalAccess, getPortalOverview } from '@/lib/data/portal';

interface PortalPageProps {
  searchParams: Promise<{ tenant?: string }>;
}

export default async function PortalOverviewPage({ searchParams }: PortalPageProps) {
  const { tenant } = await searchParams;
  const access = await getPortalAccess(tenant, true);

  if (access.status === 'signed_out') redirect('/login');

  if (access.status === 'none') {
    return (
      <div className="space-y-5">
        <PageGradientHeader
          title="Overview"
          subtitle="Track the status of work raised with your service provider."
        />
        <EmptyState
          icon={Lock}
          title="No access"
          body="Your account is not linked to any customer portal. Contact your service provider if you believe this is an error."
        />
      </div>
    );
  }

  const overview = await getPortalOverview(access.customerId);
  const several = access.options.length > 1;

  return (
    <PortalHome
      tenantName={access.tenantName}
      data={overview}
      tenant={several ? access.customerId : undefined}
      actions={several ? <TenantSelector options={access.options} selectedCustomerId={access.customerId} /> : undefined}
    />
  );
}
