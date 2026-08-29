import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantSkills } from '@/lib/actions/skills';
import {
  getJobsForTenant,
  getUnassignedJobsCountForTenant,
  getJobsStatusSummary,
  getPendingSendJobsForTenant,
  getImportBatchesForTenant,
  getSourceFieldKeysForTenant,
  getFieldFilterValuesForTenant,
  getJobsListColumnsForTenant,
  type JobsFilters,
  type JobStatus,
  type JobPriority,
} from '@/lib/data/jobs';
import {
  SYSTEM_FILTER_FIELDS,
  encodeSourceFieldFilter,
  parseFieldFiltersFromSearchParams,
  type FieldFilterValueOption,
} from '@/lib/jobs/field-filter';
import { JobsTable } from '@/components/jobs/jobs-table';
import { JobsForReviewBanner } from '@/components/jobs/jobs-for-review-banner';
import { PendingSendJobsBanner } from '@/components/jobs/pending-send-jobs-banner';
import { JobsPageErrorToast } from '@/components/jobs/jobs-page-error-toast';
import { DeclinedJobsBanner } from '@/components/jobs/declined-jobs-banner';
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
    field?: string;
    value?: string;
    f0?: string;
    v0?: string;
    f1?: string;
    v1?: string;
    f2?: string;
    v2?: string;
    f3?: string;
    v3?: string;
    f4?: string;
    v4?: string;
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
  const field_filters = parseFieldFiltersFromSearchParams(raw);
  return {
    search: raw.search?.trim() || undefined,
    status,
    priority,
    customer_id: raw.customer_id?.trim() || undefined,
    date_from: raw.date_from?.trim() || undefined,
    date_to: raw.date_to?.trim() || undefined,
    field_filters: field_filters.length > 0 ? field_filters : undefined,
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

    // Source-field ("Stored fields") filtering only ever shows up once you're
    // drilled into one customer under the Batches tab — that's what keeps
    // this dropdown from becoming a flat, ever-growing list of every header
    // from every spreadsheet layout the tenant has ever imported. The plain
    // jobs list (and Batches before a customer is picked) only offers the
    // fixed system fields.
    const scopedCustomerId =
      filters.view === 'batches' && filters.customer_id && filters.customer_id !== 'none'
        ? filters.customer_id
        : null;

    const [
      { count: unassignedCount },
      statusSummary,
      { jobs: pendingSendJobs },
      batchesResult,
      tenantSkills,
      sourceKeysResult,
      visibleColumns,
    ] = await Promise.all([
      getUnassignedJobsCountForTenant(tenantId),
      getJobsStatusSummary(tenantId),
      getPendingSendJobsForTenant(tenantId),
      getImportBatchesForTenant(tenantId),
      getTenantSkills(tenantId),
      scopedCustomerId
        ? getSourceFieldKeysForTenant(tenantId, scopedCustomerId)
        : Promise.resolve({ keys: [], error: null }),
      getJobsListColumnsForTenant(tenantId),
    ]);

    const fieldFilterOptions = [
      ...SYSTEM_FILTER_FIELDS.map((f) => ({
        value: f.key,
        label: f.label,
        group: 'System',
      })),
      ...(scopedCustomerId ? sourceKeysResult.keys ?? [] : []).map((key) => ({
        value: encodeSourceFieldFilter(key),
        label: key,
        group: 'Stored fields',
      })),
    ];

    let fieldFilterValuesByField: Record<string, FieldFilterValueOption[]> = {};
    const fieldsNeedingValues = [
      ...new Set((filters.field_filters ?? []).map((f) => f.field)),
    ];
    if (fieldsNeedingValues.length > 0) {
      const entries = await Promise.all(
        fieldsNeedingValues.map(async (field) => {
          const valuesResult = await getFieldFilterValuesForTenant(
            tenantId,
            field,
            scopedCustomerId ?? undefined
          );
          return [field, valuesResult.values] as const;
        })
      );
      fieldFilterValuesByField = Object.fromEntries(entries);
    }

    const activeBatch = activeBatchId
      ? batchesResult.batches.find((batch) => batch.id === activeBatchId) ?? null
      : null;
    // Batch is a combinable filter, not a separate mode — it must apply
    // whichever view (list or batches) the URL currently has, so the batch
    // and customer dropdowns can be used together.
    const jobsFilters: JobsFilters & { page?: number; view?: 'list' | 'batches' } = {
      ...filters,
      job_ids:
        activeBatchId && activeBatchId !== 'ungrouped'
          ? (activeBatch?.job_ids ?? [])
          : undefined,
      import_source_id: activeBatchId === 'ungrouped' ? 'ungrouped' : undefined,
    };
    const { jobs, totalCount, error } = await getJobsForTenant(tenantId, jobsFilters);

    const redirectError = rawParams.error ?? null;

    return (
      <div className="space-y-6">
        <JobsPageErrorToast error={redirectError} />
        <PageGradientHeader
          title="Jobs"
          subtitle="Manage and track all your jobs"
        />
        <DeclinedJobsBanner variant="red" />
        <PendingSendJobsBanner jobs={pendingSendJobs} tenantSkills={tenantSkills} />
        <JobsForReviewBanner count={unassignedCount} />

        <JobsTable
          initialJobs={Array.isArray(jobs) ? jobs : []}
          totalCount={typeof totalCount === 'number' ? totalCount : 0}
          initialFilters={jobsFilters}
          fetchError={error}
          statusSummary={statusSummary}
          batches={batchesResult.error ? [] : batchesResult.batches}
          activeBatchId={activeBatchId}
          fieldFilterOptions={fieldFilterOptions}
          fieldFilterValuesByField={fieldFilterValuesByField}
          initialVisibleColumns={visibleColumns}
        />
      </div>
    );
  } catch (err) {
    console.error('[JobsPage] Unexpected error:', err);
    return <JobsErrorFallback />;
  }
}
