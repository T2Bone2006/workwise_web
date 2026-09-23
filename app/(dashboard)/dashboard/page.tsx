import { format, isValid, parseISO } from 'date-fns';
import { redirect } from 'next/navigation';
import { getTenantIdForCurrentUser, getTenantNameForCurrentUser } from '@/lib/data/tenant';
import { getTenantSkills } from '@/lib/actions/skills';
import { getWorkersForTenant } from '@/lib/data/workers';
import {
  getJobsForTenant,
  getJobsStatusSummary,
  getPendingSendJobsForTenant,
  getFieldFilterValuesForTenant,
  getJobsListColumnsForTenant,
  type JobsFilters,
  type JobStatus,
  type JobPriority,
} from '@/lib/data/jobs';
import {
  SYSTEM_FILTER_FIELDS,
  parseFieldFiltersFromSearchParams,
  type FieldFilterValueOption,
} from '@/lib/jobs/field-filter';
import { JobsTable } from '@/components/jobs/jobs-table';
import { PendingSendJobsBanner } from '@/components/jobs/pending-send-jobs-banner';
import { DeclinedJobsBanner } from '@/components/jobs/declined-jobs-banner';
import { DashboardDayNav } from '@/components/dashboard/dashboard-day-nav';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';

interface DashboardPageProps {
  searchParams: Promise<{
    date?: string;
    search?: string;
    status?: string;
    priority?: string;
    customer_id?: string;
    page?: string;
    sort?: string;
    sort_dir?: string;
    group?: string;
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

function todayParam(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function parseDayParam(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) return todayParam();
  const parsed = parseISO(value);
  if (!isValid(parsed) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return todayParam();
  return value;
}

function parseSearchParams(
  raw: Awaited<DashboardPageProps['searchParams']>,
  day: string
): JobsFilters & { page?: number; view: 'list' } {
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
      : 'scheduled_date';
  const sort_dir =
    raw.sort_dir === 'asc' || raw.sort_dir === 'desc'
      ? raw.sort_dir
      : raw.sort
        ? undefined
        : 'asc';
  const field_filters = parseFieldFiltersFromSearchParams(raw);
  return {
    search: raw.search?.trim() || undefined,
    status,
    priority,
    customer_id: raw.customer_id?.trim() || undefined,
    job_group_id: raw.group?.trim() || undefined,
    date_from: day,
    date_to: day,
    field_filters: field_filters.length > 0 ? field_filters : undefined,
    sort,
    sort_dir: sort_dir ?? 'asc',
    page,
    view: 'list',
  };
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const tenantId = await getTenantIdForCurrentUser();
  const tenantName = await getTenantNameForCurrentUser();

  if (!tenantId) {
    redirect('/login');
  }

  const rawParams = await searchParams;
  const day = parseDayParam(rawParams.date);
  const filters = parseSearchParams(rawParams, day);

  const [
    statusSummary,
    { jobs: pendingSendJobs },
    tenantSkills,
    visibleColumns,
    { workers },
    { jobs, totalCount, error },
  ] = await Promise.all([
    getJobsStatusSummary(tenantId, { date_from: day, date_to: day }),
    getPendingSendJobsForTenant(tenantId),
    getTenantSkills(tenantId),
    getJobsListColumnsForTenant(tenantId),
    getWorkersForTenant(tenantId),
    getJobsForTenant(tenantId, filters),
  ]);

  const fieldFilterOptions = SYSTEM_FILTER_FIELDS.map((f) => ({
    value: f.key,
    label: f.label,
    group: 'System',
  }));

  let fieldFilterValuesByField: Record<string, FieldFilterValueOption[]> = {};
  const fieldsNeedingValues = [...new Set((filters.field_filters ?? []).map((f) => f.field))];
  if (fieldsNeedingValues.length > 0) {
    const entries = await Promise.all(
      fieldsNeedingValues.map(async (field) => {
        const valuesResult = await getFieldFilterValuesForTenant(tenantId, field);
        return [field, valuesResult.values] as const;
      })
    );
    fieldFilterValuesByField = Object.fromEntries(entries);
  }

  const dayLabel = format(parseISO(day), 'EEEE d MMMM yyyy');
  const isToday = day === format(new Date(), 'yyyy-MM-dd');

  return (
    <div className="space-y-5">
      <PageGradientHeader
        eyebrow={tenantName ?? 'Schedule'}
        title={isToday ? "Today's jobs" : 'Day schedule'}
        subtitle={dayLabel}
        actions={<DashboardDayNav selectedDate={day} />}
      />

      <DeclinedJobsBanner variant="red" />
      <PendingSendJobsBanner jobs={pendingSendJobs} tenantSkills={tenantSkills} />

      <JobsTable
        initialJobs={Array.isArray(jobs) ? jobs : []}
        totalCount={typeof totalCount === 'number' ? totalCount : 0}
        initialFilters={filters}
        fetchError={error}
        statusSummary={statusSummary}
        batches={[]}
        activeBatchId={null}
        fieldFilterOptions={fieldFilterOptions}
        fieldFilterValuesByField={fieldFilterValuesByField}
        initialVisibleColumns={visibleColumns}
        workers={workers.map((w) => ({ id: w.id, full_name: w.full_name }))}
        basePath="/dashboard"
        variant="day"
      />
    </div>
  );
}
