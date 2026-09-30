import { redirect } from 'next/navigation';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { getRoundsCustomerById } from '@/lib/data/rounds/customers';
import { getAgreementById } from '@/lib/data/rounds/agreements';
import { getServiceCatalog } from '@/lib/data/rounds/service-catalog';
import { todayInLondon } from '@/lib/rounds/dates';
import { usesRoundsCrm, paths } from '@/lib/navigation/dashboard-paths';
import { AgreementForm } from '@/components/rounds/agreement-form';
import { HistoryBackButton } from '@/components/layout/history-back-button';
import { SetBreadcrumbName } from '@/components/layout/page-breadcrumb';

interface EditAgreementPageProps {
  params: Promise<{ id: string; agreementId: string }>;
}

export default async function EditAgreementPage({
  params,
}: EditAgreementPageProps) {
  const { id: customerId, agreementId } = await params;
  const [tenantId, products] = await Promise.all([
    getTenantIdForCurrentUser(),
    getTenantProducts(),
  ]);

  if (!tenantId || !usesRoundsCrm(products)) {
    redirect(paths.customers);
  }

  const [
    { customer, error: customerError },
    { agreement, error: agreementError },
    { services },
  ] = await Promise.all([
    getRoundsCustomerById(tenantId, customerId),
    getAgreementById(tenantId, agreementId),
    getServiceCatalog(tenantId, { includeInactive: true }),
  ]);

  if (customerError || !customer) {
    redirect(paths.customers);
  }
  if (agreementError || !agreement || agreement.customer_id !== customerId) {
    redirect(paths.customer(customerId));
  }
  if (agreement.status === 'ended') {
    redirect(paths.customer(customerId));
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
            Edit agreement
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {agreement.title} · {customer.name}
          </p>
        </div>
      </div>

      <AgreementForm
        mode="edit"
        customerId={customerId}
        customerName={customer.name}
        services={services}
        today={todayInLondon()}
        agreement={agreement}
        house={{ address: agreement.address, postcode: agreement.postcode }}
      />
    </div>
  );
}
