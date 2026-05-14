import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantSkills } from '@/lib/actions/skills';
import { getWorkersListForTenant, getWorkerSkillsInUseForTenant } from '@/lib/data/workers';
import { WorkersTable } from '@/components/workers/workers-table';
import { WorkersPageErrorToast } from '@/components/workers/workers-page-error-toast';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import type { WorkerStatus, WorkerType, WorkersFilters } from '@/lib/types/worker';

const VALID_STATUSES: WorkerStatus[] = ['available', 'busy', 'unavailable', 'off_duty'];
const VALID_WORKER_TYPES: WorkerType[] = ['company_subcontractor', 'platform_solo', 'both'];

interface WorkersPageProps {
  searchParams: Promise<{
    search?: string;
    status?: string;
    worker_type?: string;
    has_skills?: string;
    sort?: string;
    sort_dir?: string;
    page?: string;
    error?: string;
  }>;
}

function parseSearchParams(
  raw: Awaited<WorkersPageProps['searchParams']>
): WorkersFilters & { page?: number } {
  const search = raw.search?.trim() || undefined;
  const statusRaw = raw.status?.trim();
  const status: WorkersFilters['status'] = statusRaw
    ? statusRaw.includes(',')
      ? (statusRaw.split(',').filter((s) => VALID_STATUSES.includes(s as WorkerStatus)) as WorkerStatus[])
      : VALID_STATUSES.includes(statusRaw as WorkerStatus)
        ? (statusRaw as WorkerStatus)
        : undefined
    : undefined;
  const worker_type =
    raw.worker_type && VALID_WORKER_TYPES.includes(raw.worker_type as WorkerType)
      ? (raw.worker_type as WorkerType)
      : undefined;
  const has_skills = raw.has_skills?.trim()
    ? raw.has_skills.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;
  const sort =
    raw.sort === 'full_name' || raw.sort === 'phone' || raw.sort === 'status'
      ? raw.sort
      : undefined;
  const sort_dir = raw.sort_dir === 'asc' || raw.sort_dir === 'desc' ? raw.sort_dir : undefined;
  const page = raw.page ? Math.max(1, parseInt(raw.page, 10) || 1) : undefined;

  return { search, status, worker_type, has_skills, sort, sort_dir, page };
}

export default async function WorkersPage({ searchParams }: WorkersPageProps) {
  const tenantId = await getTenantIdForCurrentUser();

  if (!tenantId) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
        <h2 className="text-lg font-semibold text-foreground">No tenant assigned</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account is not linked to a tenant. Please contact your administrator.
        </p>
      </div>
    );
  }

  const rawParams = await searchParams;
  const filters = parseSearchParams(rawParams);
  const [
    { workers, totalCount, error },
    { skills: allSkillsInUse, error: skillsError },
    tenantSkills,
  ] = await Promise.all([
    getWorkersListForTenant(tenantId, filters),
    getWorkerSkillsInUseForTenant(tenantId),
    getTenantSkills(tenantId),
  ]);

  const fetchError = error ?? skillsError;

  return (
    <div className="space-y-6">
      <WorkersPageErrorToast error={rawParams.error ?? null} />
      <PageGradientHeader
        title="Workers"
        subtitle="Manage workers and assign jobs"
      />

      <WorkersTable
        workers={workers}
        totalCount={totalCount}
        initialFilters={filters}
        allSkillsInUse={allSkillsInUse}
        tenantSkills={tenantSkills}
        fetchError={fetchError}
      />
    </div>
  );
}
