import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getCustomersForTenantList, type CustomersListFilters } from '@/lib/data/customers';
import { CustomersTable } from '@/components/customers/customers-table';

interface CustomersPageProps {
  searchParams: Promise<{
    search?: string;
    type?: string;
    sort?: string;
    sort_dir?: string;
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
  const filters: CustomersListFilters = {
    search: raw.search?.trim() || undefined,
    type:
      raw.type === 'bulk_client' || raw.type === 'individual'
        ? raw.type
        : undefined,
  };
  const sortCol = raw.sort === 'email' || raw.sort === 'jobs' ? raw.sort : 'name';
  const sortDir = raw.sort_dir === 'desc' ? 'desc' as const : 'asc' as const;

  const { customers, error } = await getCustomersForTenantList(tenantId, filters);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Customers
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage bulk clients and individual customers
          </p>
        </div>
      </div>

      <CustomersTable
        customers={customers}
        initialSearch={filters.search ?? ''}
        initialTypeFilter={filters.type ?? 'all'}
        initialSort={sortCol}
        initialSortDir={sortDir}
        fetchError={error}
      />
    </div>
  );
}
