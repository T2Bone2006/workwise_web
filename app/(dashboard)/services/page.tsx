import { redirect } from 'next/navigation';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { getServiceCatalog, getServicePresetGroups } from '@/lib/data/rounds/service-catalog';
import { ServiceCatalogTable } from '@/components/rounds/service-catalog-table';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';

function NoTenantMessage() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
      <h2 className="text-lg font-semibold text-foreground">No tenant assigned</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Your account is not linked to a tenant. Please contact your administrator.
      </p>
    </div>
  );
}

export default async function ServicesPage() {
  const [tenantId, products] = await Promise.all([
    getTenantIdForCurrentUser(),
    getTenantProducts(),
  ]);

  if (!products.hasRounds) {
    redirect('/dashboard');
  }
  if (!tenantId) {
    return <NoTenantMessage />;
  }

  const [{ services, error }, { groups: presetGroups, error: presetError }] =
    await Promise.all([
      getServiceCatalog(tenantId, { includeInactive: true }),
      getServicePresetGroups(),
    ]);

  return (
    <div className="space-y-6">
      <PageGradientHeader
        title="Services"
        subtitle="Usual price and how often. Each customer gets their own copy — change it when you add them, and again later, including on the day. Changing a default here does not change customers already set up."
      />
      <ServiceCatalogTable
        services={services}
        presetGroups={presetGroups}
        fetchError={error?.message ?? null}
        presetError={presetError?.message ?? null}
      />
    </div>
  );
}
