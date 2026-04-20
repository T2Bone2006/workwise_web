import Link from 'next/link';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getCustomersForTenant } from '@/lib/data/customers';
import { getWorkersForTenant } from '@/lib/data/workers';
import { JobForm } from '@/components/jobs/job-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Users, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NewJobPageProps {
  searchParams: Promise<{ customer_id?: string }>;
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

function NoCustomersEmptyState() {
  return (
    <div
      className={cn(
        'flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-border/80 p-8 text-center',
        'bg-muted/30 dark:bg-muted/20 backdrop-blur-sm',
        'glass-card shadow-[var(--shadow-glass-value)]'
      )}
    >
      <div className="mx-auto flex size-20 items-center justify-center rounded-full border border-primary/20 bg-primary/10 shadow-[0_0_24px_-4px_var(--glow-primary)]">
        <Users className="size-10 text-primary" />
      </div>
      <h3 className="mt-6 text-xl font-semibold text-foreground">No customers yet</h3>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        Create a customer before creating jobs. You need at least one customer to assign jobs to.
      </p>
      <Button variant="gradient" size="lg" className="mt-8 shadow-[var(--shadow-btn-glow-value)]" asChild>
        <Link href="/customers/new">
          Create Customer
        </Link>
      </Button>
    </div>
  );
}

export default async function NewJobPage({ searchParams }: NewJobPageProps) {
  const tenantId = await getTenantIdForCurrentUser();
  const raw = await searchParams;
  const defaultCustomerId = raw.customer_id?.trim() || undefined;

  if (!tenantId) {
    return <NoTenantMessage />;
  }

  const [customersResult, workersResult] = await Promise.all([
    getCustomersForTenant(tenantId),
    getWorkersForTenant(tenantId),
  ]);

  const customers = customersResult.customers ?? [];
  const workers = workersResult.workers ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild aria-label="Back to jobs">
          <Link href="/jobs">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Create Job
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Add a new job to your schedule
          </p>
        </div>
      </div>

      {customers.length === 0 ? (
        <NoCustomersEmptyState />
      ) : (
        <JobForm
          customers={customers}
          workers={workers}
          defaultCustomerId={defaultCustomerId}
        />
      )}
    </div>
  );
}
