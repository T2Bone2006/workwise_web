import { redirect } from 'next/navigation';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { getCustomerById } from '@/lib/data/customers';
import { getAgreementsForCustomer } from '@/lib/data/rounds/agreements';
import { getRoundsCustomerById } from '@/lib/data/rounds/customers';
import { usesProCrm, usesRoundsCrm, paths } from '@/lib/navigation/dashboard-paths';
import { splitHouse } from '@/lib/rounds/house';
import { formatUkPhoneDisplay } from '@/lib/utils/phone';
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

  const rounds = usesRoundsCrm(products);
  if (!rounds && !usesProCrm(products)) {
    redirect('/dashboard');
  }

  const { customer, error } = rounds
    ? await getRoundsCustomerById(tenantId, customerId)
    : await getCustomerById(tenantId, customerId);
  if (error || !customer) {
    redirect(paths.customers);
  }

  // Older rounds customers only have the address on a service. The form
  // reads the customer line first, and uses this when that line is empty.
  let house: { address: string; postcode: string } | null = null;
  if (rounds && !splitHouse(customer.address).address) {
    const { agreements } = await getAgreementsForCustomer(tenantId, customerId);
    const live = agreements.filter((agreement) => agreement.status === 'active');
    const primary = live[0] ?? agreements[0] ?? null;
    if (primary?.address?.trim()) {
      house = { address: primary.address, postcode: primary.postcode ?? '' };
    }
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
        variant={rounds ? 'rounds' : 'pro'}
        tenantId={tenantId}
        customer={{
          ...customer,
          phone: rounds
            ? formatUkPhoneDisplay(customer.phone_e164) || customer.phone
            : customer.phone,
        }}
        house={house}
        jobCount={customer.job_count ?? 0}
      />
    </div>
  );
}
