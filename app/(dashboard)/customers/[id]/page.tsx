import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getCustomerById, getCustomerJobStats } from '@/lib/data/customers';
import { getRecentJobsForCustomer, type RecentJobRow } from '@/lib/data/jobs';
import { CustomerDetailView } from '@/components/customers/customer-detail-view';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

interface CustomerDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function CustomerDetailPage({ params }: CustomerDetailPageProps) {
  const { id: customerId } = await params;
  const tenantId = await getTenantIdForCurrentUser();

  if (!tenantId) {
    redirect('/customers');
  }

  const [{ customer, error: customerError }, { stats, error: statsError }, { jobs: recentJobs, error: jobsError }] =
    await Promise.all([
      getCustomerById(tenantId, customerId),
      getCustomerJobStats(tenantId, customerId),
      getRecentJobsForCustomer(tenantId, customerId, 10),
    ]);

  if (customerError || !customer) {
    redirect('/customers');
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild aria-label="Back to customers">
          <Link href="/customers">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground truncate">
            {customer.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Customer details and job history
          </p>
        </div>
      </div>

      <CustomerDetailView
        customer={customer}
        stats={stats}
        recentJobs={recentJobs}
        statsError={statsError}
        jobsError={jobsError}
      />
    </div>
  );
}
