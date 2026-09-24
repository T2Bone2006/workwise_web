import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { getRoundsCustomerById } from '@/lib/data/rounds/customers';
import { getServiceCatalog } from '@/lib/data/rounds/service-catalog';
import { todayInLondon } from '@/lib/rounds/dates';
import { usesRoundsCrm, paths } from '@/lib/navigation/dashboard-paths';
import { AgreementForm } from '@/components/rounds/agreement-form';
import { Button } from '@/components/ui/button';

interface NewAgreementPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ first?: string }>;
}

export default async function NewAgreementPage({
  params,
  searchParams,
}: NewAgreementPageProps) {
  const { id: customerId } = await params;
  const { first } = await searchParams;
  const [tenantId, products] = await Promise.all([
    getTenantIdForCurrentUser(),
    getTenantProducts(),
  ]);

  if (!tenantId || !usesRoundsCrm(products)) {
    redirect(paths.customers);
  }

  const [{ customer, error }, { services }] = await Promise.all([
    getRoundsCustomerById(tenantId, customerId),
    getServiceCatalog(tenantId),
  ]);

  if (error || !customer) {
    redirect(paths.customers);
  }

  const showFirstBanner = first === '1';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          asChild
          aria-label="Back to customer"
        >
          <Link href={paths.customer(customerId)}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
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
      />
    </div>
  );
}
