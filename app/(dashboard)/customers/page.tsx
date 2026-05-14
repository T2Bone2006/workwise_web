import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getCustomersForTenantList, type CustomersListFilters } from '@/lib/data/customers';
import { CustomersTable } from '@/components/customers/customers-table';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';

interface CustomersPageProps {
  searchParams: Promise<{
    search?: string;
    type?: string;
    sort?: string;
    sort_dir?: string;
    page?: string;
  }>;
}

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

export default async function CustomersPage({ searchParams }: CustomersPageProps) {
  const tenantId = await getTenantIdForCurrentUser();

  if (!tenantId) {
    return <NoTenantMessage />;
  }

  const raw = await searchParams;
  const page = raw.page ? Math.max(1, parseInt(raw.page, 10) || 1) : undefined;
  const filters: CustomersListFilters & { page?: number } = {
    search: raw.search?.trim() || undefined,
    type:
      raw.type === 'bulk_client' || raw.type === 'individual'
        ? raw.type
        : undefined,
    sort: raw.sort === 'email' || raw.sort === 'jobs' ? raw.sort : 'name',
    sort_dir: raw.sort_dir === 'desc' ? 'desc' : 'asc',
    page,
  };

  const { customers, totalCount, error } = await getCustomersForTenantList(tenantId, filters);

  return (
    <div className="space-y-6">
      <PageGradientHeader
        title="Customers"
        subtitle="Manage bulk clients and individual customers"
      />

      <CustomersTable
        customers={customers}
        totalCount={totalCount}
        initialFilters={filters}
        fetchError={error}
      />
    </div>
  );
}
