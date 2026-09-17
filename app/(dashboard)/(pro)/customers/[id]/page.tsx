import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import {
  getCustomerById,
  getCustomerJobStats,
  getCustomerWorkerFields,
} from '@/lib/data/customers';
import { getRecentJobsForCustomer } from '@/lib/data/jobs';
import { getCustomerPortalInviteState } from '@/lib/actions/customers';
import { CustomerDetailView } from '@/components/customers/customer-detail-view';
import { CustomerDeleteButton } from '@/components/customers/customer-delete-button';
import { CustomerWorkerFieldsCard } from '@/components/customers/customer-worker-fields-card';
import { RevokeCustomerPortalAccessButton } from '@/components/customers/customers-table';
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

  const [
    { customer, error: customerError },
    { stats, error: statsError },
    { jobs: recentJobs, error: jobsError },
    portalState,
    { data: workerFields },
  ] = await Promise.all([
    getCustomerById(tenantId, customerId),
    getCustomerJobStats(tenantId, customerId),
    getRecentJobsForCustomer(tenantId, customerId, 10),
    getCustomerPortalInviteState(customerId),
    getCustomerWorkerFields(tenantId, customerId),
  ]);

  const hasPortalUser = portalState.success && portalState.hasPortalUser;

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
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {hasPortalUser && (
            <RevokeCustomerPortalAccessButton customerId={customerId} />
          )}
          <CustomerDeleteButton
            customerId={customerId}
            customerName={customer.name}
            useDeactivate
          />
        </div>
      </div>

      <CustomerDetailView
        customer={customer}
        stats={stats}
        recentJobs={recentJobs}
        statsError={statsError}
        jobsError={jobsError}
      />

      <CustomerWorkerFieldsCard
        customerId={customerId}
        initialFields={workerFields.fields}
        newKeys={workerFields.newKeys}
        neverConfigured={workerFields.neverConfigured}
      />
    </div>
  );
}
