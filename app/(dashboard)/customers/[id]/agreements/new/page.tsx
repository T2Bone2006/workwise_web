import { redirect } from 'next/navigation';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { getRoundsCustomerById } from '@/lib/data/rounds/customers';
import { getAgreementsForCustomer } from '@/lib/data/rounds/agreements';
import { getServiceCatalog } from '@/lib/data/rounds/service-catalog';
import { todayInLondon } from '@/lib/rounds/dates';
import { splitHouse } from '@/lib/rounds/house';
import { usesRoundsCrm, paths } from '@/lib/navigation/dashboard-paths';
import { AgreementForm } from '@/components/rounds/agreement-form';
import { HistoryBackButton } from '@/components/layout/history-back-button';
import { SetBreadcrumbName } from '@/components/layout/page-breadcrumb';

interface NewAgreementPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ first?: string; address?: string; postcode?: string; lat?: string; lng?: string }>;
}

export default async function NewAgreementPage({
  params,
  searchParams,
}: NewAgreementPageProps) {
  const { id: customerId } = await params;
  const { first, address, postcode, lat, lng } = await searchParams;
  const [tenantId, products] = await Promise.all([
    getTenantIdForCurrentUser(),
    getTenantProducts(),
  ]);

  if (!tenantId || !usesRoundsCrm(products)) {
    redirect(paths.customers);
  }

  const [{ customer, error }, { services }, { agreements }] = await Promise.all([
    getRoundsCustomerById(tenantId, customerId),
    getServiceCatalog(tenantId),
    getAgreementsForCustomer(tenantId, customerId),
  ]);

  if (error || !customer) {
    redirect(paths.customers);
  }

  const showFirstBanner = first === '1';
  const stored = splitHouse(customer.address);
  const existingHouse = agreements.find((row) => row.address.trim() && row.postcode.trim());
  const house =
    stored.address && stored.postcode
      ? stored
      : existingHouse
        ? { address: existingHouse.address, postcode: existingHouse.postcode }
        : address && postcode
          ? { address, postcode }
          : null;

  // The exact spot for that address: dropped when the customer was created, or
  // already on one of their services there.
  const urlPin =
    lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
      ? { lat: Number(lat), lng: Number(lng) }
      : null;
  const atHouse = house
    ? agreements.find(
        (row) =>
          row.status !== 'ended' &&
          row.address === house.address &&
          row.postcode === house.postcode &&
          row.lat != null &&
          row.lng != null,
      )
    : null;
  const initialPin = urlPin ?? (atHouse ? { lat: atHouse.lat as number, lng: atHouse.lng as number } : null);

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
            {showFirstBanner ? 'Add their first service' : 'New agreement'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {customer.name}
          </p>
        </div>
      </div>

      <AgreementForm
        mode="create"
        customerId={customerId}
        customerName={customer.name}
        services={services}
        today={todayInLondon()}
        showFirstBanner={showFirstBanner}
        house={house}
        initialPin={initialPin}
      />
    </div>
  );
}
