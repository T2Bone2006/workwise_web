import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantSkills } from '@/lib/actions/skills';
import {
  getJobsForTenant,
  getUnassignedJobsCountForTenant,
  getJobsStatusSummary,
  getPendingSendJobsForTenant,
  getCustomerJobCounts,
  getImportBatchesForTenant,
  type JobsFilters,
  type JobStatus,
  type JobPriority,
  type CustomerJobCount,
} from '@/lib/data/jobs';
import { JobsTable } from '@/components/jobs/jobs-table';
import { JobsForReviewBanner } from '@/components/jobs/jobs-for-review-banner';
import { PendingSendJobsBanner } from '@/components/jobs/pending-send-jobs-banner';
import { JobsPageErrorToast } from '@/components/jobs/jobs-page-error-toast';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';

interface JobsPageProps {
  searchParams: Promise<{
    search?: string;
    status?: string;
    priority?: string;
    customer_id?: string;
    date_from?: string;
    date_to?: string;
    page?: string;
    sort?: string;
    sort_dir?: string;
    view?: string;
    batchId?: string;
    error?: string;
  }>;
}

const VALID_STATUS: JobStatus[] = [
  'pending',
  'pending_send',
  'assigned',
  'in_progress',
  'paused',
  'completed',
  'cancelled',
];
const VALID_PRIORITY: JobPriority[] = ['low', 'normal', 'high', 'emergency'];

function parseSearchParams(
  raw: Awaited<JobsPageProps['searchParams']>
): JobsFilters & { page?: number; view?: 'list' | 'batches' } {
  const statusRaw = raw.status?.trim();
  const status: JobStatus | JobStatus[] | undefined = statusRaw
    ? statusRaw.includes(',')
      ? (statusRaw.split(',').filter((s) => VALID_STATUS.includes(s as JobStatus)) as JobStatus[])
      : VALID_STATUS.includes(statusRaw as JobStatus)
        ? (statusRaw as JobStatus)
        : undefined
    : undefined;
  const priority =
    raw.priority && VALID_PRIORITY.includes(raw.priority as JobPriority)
      ? (raw.priority as JobPriority)
      : undefined;
  const page = raw.page ? Math.max(1, parseInt(raw.page, 10) || 1) : undefined;
  const sort =
    raw.sort === 'reference_number' ||
    raw.sort === 'status' ||
    raw.sort === 'priority' ||
    raw.sort === 'scheduled_date' ||
    raw.sort === 'customer_name' ||
    raw.sort === 'created_at'
      ? raw.sort
      : undefined;
  const sort_dir = raw.sort_dir === 'asc' || raw.sort_dir === 'desc' ? raw.sort_dir : undefined;
  const view = raw.view === 'batches' ? raw.view : 'list';
  return {
    search: raw.search?.trim() || undefined,
    status,
    priority,
    customer_id: raw.customer_id?.trim() || undefined,
    date_from: raw.date_from?.trim() || undefined,
    date_to: raw.date_to?.trim() || undefined,
    sort,
    sort_dir,
    page,
    view,
  };
}

function NoTenantMessage() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
      <h2 className="text-lg font-semibold text-foreground">
        No tenant assigned
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Your account is not linked to a tenant. Please contact your
        administrator.
      </p>
    </div>
  );
}

function JobsErrorFallback() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
      <h2 className="text-lg font-semibold text-foreground">
        Unable to load jobs
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Something went wrong. Please try again or contact support.
      </p>
      <p className="mt-4 text-xs text-muted-foreground">
        Please contact support if this continues.
      </p>
    </div>
  );
}

export default async function JobsPage({ searchParams }: JobsPageProps) {
  try {
    const tenantId = await getTenantIdForCurrentUser();

    if (!tenantId) {
      return <NoTenantMessage />;
    }

    const rawParams = await searchParams;
    const activeBatchId = rawParams.batchId?.trim() || null;
    let filters: JobsFilters & { page?: number; view?: 'list' | 'batches' };
    try {
      filters = parseSearchParams(rawParams);
    } catch (paramErr) {
      console.error('[JobsPage] searchParams parse error:', paramErr);
      filters = {};
    }

    const [
      { count: unassignedCount },
      statusSummary,
      { jobs: pendingSendJobs },
      customerJobCountsResult,
      batchesResult,
      tenantSkills,
    ] = await Promise.all([
      getUnassignedJobsCountForTenant(tenantId),
      getJobsStatusSummary(tenantId),
      getPendingSendJobsForTenant(tenantId),
      getCustomerJobCounts(tenantId),
      getImportBatchesForTenant(tenantId),
      getTenantSkills(tenantId),
    ]);

    const activeBatch = activeBatchId
      ? batchesResult.batches.find((batch) => batch.id === activeBatchId) ?? null
      : null;
    // Batch is a combinable filter, not a separate mode — it must apply
    // whichever view (list or batches) the URL currently has, so the batch
    // and customer dropdowns can be used together.
    const jobsFilters: JobsFilters & { page?: number; view?: 'list' | 'batches' } = {
      ...filters,
      import_source_id: activeBatchId
        ? activeBatchId === 'ungrouped'
          ? 'ungrouped'
          : (activeBatch?.import_source_id ?? undefined)
        : undefined,
    };
    const { jobs, totalCount, error } = await getJobsForTenant(tenantId, jobsFilters);

    const redirectError = rawParams.error ?? null;
    const customerFilterOptions: CustomerJobCount[] = customerJobCountsResult.error
      ? []
      : customerJobCountsResult.customers;

    return (
      <div className="space-y-6">
        <JobsPageErrorToast error={redirectError} />
        <PendingSendJobsBanner jobs={pendingSendJobs} tenantSkills={tenantSkills} />
        <JobsForReviewBanner count={unassignedCount} />
        <PageGradientHeader
          title="Jobs"
          subtitle="Manage and track all your jobs"
        />

        <JobsTable
          initialJobs={Array.isArray(jobs) ? jobs : []}
          totalCount={typeof totalCount === 'number' ? totalCount : 0}
          initialFilters={jobsFilters}
          fetchError={error}
          statusSummary={statusSummary}
          customerFilterOptions={customerFilterOptions}
          batches={batchesResult.error ? [] : batchesResult.batches}
          activeBatchId={activeBatchId}
        />
      </div>
    );
  } catch (err) {
    console.error('[JobsPage] Unexpected error:', err);
    return <JobsErrorFallback />;
  }
}
