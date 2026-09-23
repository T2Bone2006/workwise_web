import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { TenantSelector, type PortalTenantOption } from '@/components/portal/tenant-selector';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { JobsTable } from '@/components/jobs/jobs-table';
import {
  getJobsForCustomer,
  getJobsStatusSummaryForCustomer,
  getSourceFieldKeysForCustomer,
  getFieldFilterValuesForCustomer,
  getImportBatchesForCustomer,
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
import type { JobsListColumnKey } from '@/lib/data/settings-types';

type TenantRef = { id: string; name: string };
type CustomerRef = {
  id: string;
  name: string;
  tenant_id: string;
  tenants: TenantRef | TenantRef[] | null;
};

const PORTAL_COLUMNS: JobsListColumnKey[] = [
  'address',
  'postcode',
  'scheduled',
  'priority',
  'status',
];

const PORTAL_SYSTEM_FILTERS = SYSTEM_FILTER_FIELDS.filter(
  (f) => f.key === 'status' || f.key === 'priority' || f.key === 'postcode'
);

const VALID_STATUS: JobStatus[] = [
  'pending',
  'pending_send',
  'assigned',
  'in_progress',
  'paused',
  'completed',
  'cancelled',
  'incomplete',
  'declined',
];
const VALID_PRIORITY: JobPriority[] = ['low', 'normal', 'high', 'emergency'];

interface PortalPageProps {
  searchParams: Promise<{
    tenant?: string;
    search?: string;
    status?: string;
    priority?: string;
    date_from?: string;
    date_to?: string;
    page?: string;
    sort?: string;
    sort_dir?: string;
    group?: string;
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
  }>;
}

function normalizeCustomer(
  raw: CustomerRef | CustomerRef[] | null | undefined
): CustomerRef | null {
  if (!raw) return null;
  const customer = Array.isArray(raw) ? raw[0] : raw;
  if (!customer?.id) return null;
  return customer;
}

function resolveTenantName(tenants: CustomerRef['tenants']): string {
  if (!tenants) return 'Unknown';
  if (Array.isArray(tenants)) {
    return tenants[0]?.name?.trim() || 'Unknown';
  }
  return tenants.name?.trim() || 'Unknown';
}

function parsePortalSearchParams(
  raw: Awaited<PortalPageProps['searchParams']>
): JobsFilters & { page?: number } {
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
    raw.sort === 'created_at'
      ? raw.sort
      : undefined;
  const sort_dir = raw.sort_dir === 'asc' || raw.sort_dir === 'desc' ? raw.sort_dir : undefined;
  const field_filters = parseFieldFiltersFromSearchParams(raw);
  return {
    search: raw.search?.trim() || undefined,
    status,
    priority,
    job_group_id: raw.group?.trim() || undefined,
    date_from: raw.date_from?.trim() || undefined,
    date_to: raw.date_to?.trim() || undefined,
    field_filters: field_filters.length > 0 ? field_filters : undefined,
    sort,
    sort_dir,
    page,
  };
}

export default async function PortalPage({ searchParams }: PortalPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/portal/login');
  }

  const { data: portalRows, error: portalError } = await supabase
    .from('customer_portal_users')
    .select(
      `
      customer_id,
      customers (
        id,
        name,
        tenant_id,
        tenants (
          id,
          name
        )
      )
    `
    )
    .eq('user_id', user.id);

  if (portalError) {
    console.error('[PortalPage] customer_portal_users:', portalError);
  }

  const tenantOptions: PortalTenantOption[] = (portalRows ?? [])
    .map((row) => {
      const record = row as { customers?: CustomerRef | CustomerRef[] | null };
      const customer = normalizeCustomer(record.customers);
      if (!customer) return null;
      return {
        customerId: customer.id,
        tenantName: resolveTenantName(customer.tenants),
      };
    })
    .filter((option): option is PortalTenantOption => option !== null);

  if (tenantOptions.length === 0) {
    return (
      <div className="space-y-5">
        <PageGradientHeader
          title="Your jobs"
          subtitle="Track the status of work raised with your service provider."
        />
        <div className="flex flex-col items-center justify-center rounded-2xl border border-border/70 bg-muted/20 px-6 py-16 text-center">
          <h2 className="text-lg font-semibold text-foreground">No access</h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Your account is not linked to any customer portal. Contact your service provider if you
            believe this is an error.
          </p>
        </div>
      </div>
    );
  }

  const raw = await searchParams;
  const tenantParam = raw.tenant?.trim();
  const selectedCustomerId =
    tenantParam && tenantOptions.some((o) => o.customerId === tenantParam)
      ? tenantParam
      : tenantOptions[0]!.customerId;

  const selectedTenantName =
    tenantOptions.find((o) => o.customerId === selectedCustomerId)?.tenantName ?? 'Unknown';

  await supabase
    .from('customers')
    .update({ portal_last_accessed_at: new Date().toISOString() })
    .eq('id', selectedCustomerId);

  let filters: JobsFilters & { page?: number };
  try {
    filters = parsePortalSearchParams(raw);
  } catch (paramErr) {
    console.error('[PortalPage] searchParams parse error:', paramErr);
    filters = {};
  }

  const activeBatchId = raw.batchId?.trim() || null;

  const [statusSummary, sourceKeysResult, batchesResult] = await Promise.all([
    getJobsStatusSummaryForCustomer(selectedCustomerId),
    getSourceFieldKeysForCustomer(selectedCustomerId),
    getImportBatchesForCustomer(selectedCustomerId),
  ]);

  const batches = batchesResult.error ? [] : batchesResult.batches;
  const activeBatch = activeBatchId
    ? batches.find((batch) => batch.id === activeBatchId) ?? null
    : null;

  const jobsFilters: JobsFilters & { page?: number } = {
    ...filters,
    customer_id: selectedCustomerId,
    job_ids:
      activeBatchId && activeBatchId !== 'ungrouped'
        ? (activeBatch?.job_ids ?? [])
        : undefined,
  };

  const { jobs, totalCount, error } = await getJobsForCustomer(
    selectedCustomerId,
    jobsFilters
  );

  const fieldFilterOptions = [
    ...PORTAL_SYSTEM_FILTERS.map((f) => ({
      value: f.key,
      label: f.label,
      group: 'System',
    })),
    ...(sourceKeysResult.keys ?? []).map((key) => ({
      value: encodeSourceFieldFilter(key),
      label: key,
      group: 'Stored fields',
    })),
  ];

  let fieldFilterValuesByField: Record<string, FieldFilterValueOption[]> = {};
  const fieldsNeedingValues = [
    ...new Set((jobsFilters.field_filters ?? []).map((f) => f.field)),
  ];
  if (fieldsNeedingValues.length > 0) {
    const entries = await Promise.all(
      fieldsNeedingValues.map(async (field) => {
        const valuesResult = await getFieldFilterValuesForCustomer(
          selectedCustomerId,
          field
        );
        return [field, valuesResult.values] as const;
      })
    );
    fieldFilterValuesByField = Object.fromEntries(entries);
  }

  return (
    <div className="space-y-5">
      <PageGradientHeader
        eyebrow={selectedTenantName}
        title="Your jobs"
        subtitle="Search, filter, and track work raised with your service provider."
        actions={
          tenantOptions.length > 1 ? (
            <TenantSelector options={tenantOptions} selectedCustomerId={selectedCustomerId} />
          ) : undefined
        }
      />

      {tenantOptions.length === 1 ? (
        <p className="text-sm text-muted-foreground">
          Viewing jobs for <span className="font-medium text-foreground">{selectedTenantName}</span>
        </p>
      ) : null}

      <Suspense
        fallback={
          <div className="h-[28rem] animate-pulse rounded-xl border border-border/70 bg-muted/25" />
        }
      >
        <JobsTable
          variant="portal"
          basePath="/portal"
          initialJobs={Array.isArray(jobs) ? jobs : []}
          totalCount={typeof totalCount === 'number' ? totalCount : 0}
          initialFilters={jobsFilters}
          fetchError={error}
          statusSummary={statusSummary}
          batches={batches}
          activeBatchId={activeBatchId}
          fieldFilterOptions={fieldFilterOptions}
          fieldFilterValuesByField={fieldFilterValuesByField}
          initialVisibleColumns={PORTAL_COLUMNS}
          workers={[]}
        />
      </Suspense>
    </div>
  );
}
