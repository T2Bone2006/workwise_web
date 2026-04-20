import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { WorkersTable } from '@/components/workers/workers-table';
import { WorkersPageErrorToast } from '@/components/workers/workers-page-error-toast';
import type {
  WorkerInviteStatus,
  WorkerRow,
  WorkersFilters,
  WorkerStatus,
  WorkerType,
} from '@/lib/types/worker';

async function getWorkersForTenant(tenantId: string) {
  const { createClient } = await import('@/lib/supabase/server');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('workers')
    .select('*')
    .eq('primary_tenant_id', tenantId)
    .order('full_name', { ascending: true });

  if (error) {
    console.error('[WorkersPage] getWorkers error:', error);
    return { workers: [], error: new Error(error.message) };
  }

  const workers: WorkerRow[] = (Array.isArray(data) ? data : []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    primary_tenant_id: String(row.primary_tenant_id),
    full_name: String(row.full_name ?? ''),
    phone: row.phone != null ? String(row.phone) : null,
    email: row.email != null ? String(row.email) : null,
    invite_status:
      row.invite_status === 'pending' ? 'pending' : ('active' as WorkerInviteStatus),
    home_postcode: row.home_postcode != null ? String(row.home_postcode) : null,
    home_lat: typeof row.home_lat === 'number' ? row.home_lat : null,
    home_lng: typeof row.home_lng === 'number' ? row.home_lng : null,
    worker_type: (row.worker_type as WorkerType) ?? null,
    status: (row.status as WorkerStatus) ?? null,
    skills: Array.isArray(row.skills) ? (row.skills as string[]) : null,
    created_at: row.created_at != null ? String(row.created_at) : undefined,
    updated_at: row.updated_at != null ? String(row.updated_at) : undefined,
  }));

  return { workers, error: null };
}

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
    error?: string;
  }>;
}

function parseSearchParams(raw: Awaited<WorkersPageProps['searchParams']>): WorkersFilters {
  const search = raw.search?.trim() || undefined;
  const statusRaw = raw.status?.trim();
  const status: WorkersFilters['status'] = statusRaw
    ? statusRaw.includes(',')
      ? (statusRaw.split(',').filter((s) => VALID_STATUSES.includes(s as WorkerStatus)) as WorkerStatus[])
      : VALID_STATUSES.includes(statusRaw as WorkerStatus)
        ? (statusRaw as WorkerStatus)
        : undefined
    : undefined;
  const worker_type = raw.worker_type && VALID_WORKER_TYPES.includes(raw.worker_type as WorkerType)
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

  return { search, status, worker_type, has_skills, sort, sort_dir };
}

function applyFilters(
  workers: WorkerRow[],
  filters: WorkersFilters
): WorkerRow[] {
  let list = [...workers];

  if (filters.search) {
    const q = filters.search.toLowerCase();
    list = list.filter(
      (w) =>
        w.full_name.toLowerCase().includes(q) ||
        (w.phone ?? '').toLowerCase().includes(q) ||
        (w.email ?? '').toLowerCase().includes(q)
    );
  }

  if (filters.status) {
    const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
    list = list.filter((w) => w.status && statuses.includes(w.status));
  }

  if (filters.worker_type) {
    list = list.filter((w) => w.worker_type === filters.worker_type);
  }

  const hasSkillsArr = Array.isArray(filters.has_skills)
    ? filters.has_skills
    : filters.has_skills
      ? [filters.has_skills]
      : [];
  if (hasSkillsArr.length) {
    list = list.filter(
      (w) =>
        w.skills?.length &&
        hasSkillsArr.some((s) => w.skills!.includes(s))
    );
  }

  const sort = filters.sort ?? 'full_name';
  const dir = filters.sort_dir ?? 'asc';
  list.sort((a, b) => {
    let aVal: string | null = null;
    let bVal: string | null = null;
    if (sort === 'full_name') {
      aVal = a.full_name;
      bVal = b.full_name;
    } else if (sort === 'phone') {
      aVal = a.phone;
      bVal = b.phone;
    } else if (sort === 'status') {
      aVal = a.status ?? '';
      bVal = b.status ?? '';
    }
    if (aVal === null) aVal = '';
    if (bVal === null) bVal = '';
    const cmp = aVal.localeCompare(bVal, undefined, { sensitivity: 'base' });
    return dir === 'asc' ? cmp : -cmp;
  });

  return list;
}

function collectAllSkillsInUse(workers: WorkerRow[]): string[] {
  const set = new Set<string>();
  workers.forEach((w) => {
    w.skills?.forEach((s) => set.add(s));
  });
  return Array.from(set);
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
  const { workers: rawWorkers, error } = await getWorkersForTenant(tenantId);
  const workers = applyFilters(rawWorkers, filters);
  const allSkillsInUse = collectAllSkillsInUse(rawWorkers);

  return (
    <div className="space-y-6">
      <WorkersPageErrorToast error={rawParams.error ?? null} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Workers
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage locksmith subcontractors and assign jobs
          </p>
        </div>
      </div>

      <WorkersTable
        workers={workers}
        initialFilters={filters}
        allSkillsInUse={allSkillsInUse}
        fetchError={error}
      />
    </div>
  );
}
