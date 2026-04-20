import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getCustomerById } from '@/lib/data/customers';
import { CustomerForm } from '@/components/customers/customer-form';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

interface CustomerEditPageProps {
  params: Promise<{ id: string }>;
}

export default async function CustomerEditPage({ params }: CustomerEditPageProps) {
  const { id: customerId } = await params;
  const tenantId = await getTenantIdForCurrentUser();

  if (!tenantId) {
    redirect('/customers');
  }

  const { customer, error } = await getCustomerById(tenantId, customerId);

  if (error || !customer) {
    redirect('/customers');
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild aria-label="Back to customer">
          <Link href={`/customers/${customerId}`}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
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
