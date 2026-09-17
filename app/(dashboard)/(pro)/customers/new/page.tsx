import Link from 'next/link';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { CustomerForm } from '@/components/customers/customer-form';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

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

export default async function NewCustomerPage() {
  const tenantId = await getTenantIdForCurrentUser();

  if (!tenantId) {
    return <NoTenantMessage />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild aria-label="Back to customers">
          <Link href="/customers">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Add Customer
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a new bulk client or individual customer
          </p>
        </div>
      </div>

      <CustomerForm mode="create" tenantId={tenantId} />
    </div>
  );
}
