import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getCustomersForTenantList, type CustomersListFilters } from '@/lib/data/customers';
import {
  getCustomerInvitesForTenant,
  getCustomersWithPortalAccess,
} from '@/lib/data/customer-invites';
import { CustomersTable } from '@/components/customers/customers-table';
import { CustomerInvitesTable } from '@/components/customers/customer-invites-table';
import { CustomerPortalAccessTable } from '@/components/customers/customer-portal-access-table';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface CustomersPageProps {
  searchParams: Promise<{
    search?: string;
    type?: string;
    sort?: string;
    sort_dir?: string;
    page?: string;
    tab?: string;
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
  const defaultTab =
    raw.tab === 'invites' || raw.tab === 'portal-access' ? raw.tab : 'customers';

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

  const [
    { customers, totalCount, error },
    { invites },
    { customers: portalCustomers },
  ] = await Promise.all([
    getCustomersForTenantList(tenantId, filters),
    getCustomerInvitesForTenant(tenantId),
    getCustomersWithPortalAccess(tenantId),
  ]);

  return (
    <div className="space-y-6">
      <PageGradientHeader
        title="Customers"
        subtitle="Manage bulk clients and individual customers"
      />

      <Tabs defaultValue={defaultTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="customers">Customers</TabsTrigger>
          <TabsTrigger value="invites">Portal Invites ({invites.length})</TabsTrigger>
          <TabsTrigger value="portal-access">
            Portal Access ({portalCustomers.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="customers" className="mt-0">
          <CustomersTable
            customers={customers}
            totalCount={totalCount}
            initialFilters={filters}
            fetchError={error}
          />
        </TabsContent>

        <TabsContent value="invites" className="mt-0">
          <CustomerInvitesTable invites={invites} />
        </TabsContent>

        <TabsContent value="portal-access" className="mt-0">
          <CustomerPortalAccessTable customers={portalCustomers} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
