import { redirect } from 'next/navigation';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { getCustomerById } from '@/lib/data/customers';
import { usesProCrm, usesRoundsCrm, paths } from '@/lib/navigation/dashboard-paths';
import { CustomerForm } from '@/components/customers/customer-form';
import { HistoryBackButton } from '@/components/layout/history-back-button';
import { SetBreadcrumbName } from '@/components/layout/page-breadcrumb';

interface CustomerEditPageProps {
  params: Promise<{ id: string }>;
}

export default async function CustomerEditPage({ params }: CustomerEditPageProps) {
  const { id: customerId } = await params;
  const [tenantId, products] = await Promise.all([
    getTenantIdForCurrentUser(),
    getTenantProducts(),
  ]);

  if (!tenantId) {
    redirect(paths.customers);
  }

  if (usesRoundsCrm(products)) {
    redirect(paths.customer(customerId));
  }

  if (!usesProCrm(products)) {
    redirect('/dashboard');
  }

  const { customer, error } = await getCustomerById(tenantId, customerId);
  if (error || !customer) {
    redirect(paths.customers);
  }

  return (
    <div className="space-y-6">
      <SetBreadcrumbName id={customerId} name={customer.name} />
      <div className="flex items-center gap-4">
        <HistoryBackButton
          iconOnly
          label="Back to customer"
          fallbackHref={paths.customer(customerId)}
        />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Edit customer
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Update details for {customer.name}
          </p>
        </div>
      </div>
      <CustomerForm
        mode="edit"
        tenantId={tenantId}
        customer={customer}
        jobCount={customer.job_count ?? 0}
      />
    </div>
  );
}
