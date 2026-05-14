import { createClient } from '@/lib/supabase/server';
import type {
  WorkerInviteStatus,
  WorkerRow as AdminWorkerRow,
  WorkerStatus,
  WorkerType,
  WorkersFilters,
} from '@/lib/types/worker';

const PAGE_SIZE = 50;

export interface WorkerRow {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  status: string | null;
  exclude_from_auto_assign: boolean;
}

/**
 * Fetches workers available for the given tenant.
 * Uses workers.primary_tenant_id and workers.status = 'available'.
 * Never throws - returns empty array on error.
 */
export async function getWorkersForTenant(
  tenantId: string
): Promise<{ workers: WorkerRow[]; error: Error | null }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('workers')
      .select(
        `
        id,
        full_name,
        phone,
        email,
        status,
        worker_tenants!inner(exclude_from_auto_assign)
      `
      )
      .eq('primary_tenant_id', tenantId)
      .eq('worker_tenants.tenant_id', tenantId)
      .eq('status', 'available')
      .order('full_name');

    if (error) {
      console.error('[getWorkersForTenant] workers', error);
      return { workers: [], error: new Error(error.message ?? 'Failed to load workers') };
    }

    const workers: WorkerRow[] = (Array.isArray(data) ? data : []).map(
      (row: {
        id: string;
        full_name: string;
        phone?: string | null;
        email?: string | null;
        status?: string | null;
        worker_tenants?:
          | { exclude_from_auto_assign?: boolean | null }
          | Array<{ exclude_from_auto_assign?: boolean | null }>;
      }) => ({
        id: row.id,
        full_name: row.full_name ?? '',
        phone: row.phone ?? null,
        email: row.email ?? null,
        status: row.status ?? null,
        exclude_from_auto_assign: Array.isArray(row.worker_tenants)
          ? Boolean(row.worker_tenants[0]?.exclude_from_auto_assign)
          : Boolean(row.worker_tenants?.exclude_from_auto_assign),
      })
    );
    return { workers, error: null };
  } catch (err) {
    console.error('[getWorkersForTenant]', err);
    return {
      workers: [],
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

function mapAdminWorkerRow(row: Record<string, unknown>): AdminWorkerRow {
  const skillsRaw = row.skills;
  return {
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
    skills: Array.isArray(skillsRaw) ? (skillsRaw as string[]) : null,
    created_at: row.created_at != null ? String(row.created_at) : undefined,
    updated_at: row.updated_at != null ? String(row.updated_at) : undefined,
  };
}

/** Skills present on any worker in the tenant (for filter dropdown). */
export async function getWorkerSkillsInUseForTenant(
  tenantId: string
): Promise<{ skills: string[]; error: Error | null }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from('workers').select('skills').eq('primary_tenant_id', tenantId);

    if (error) {
      console.error('[getWorkerSkillsInUseForTenant]', error);
      return { skills: [], error: new Error(error.message ?? 'Failed to load skills') };
    }

    const set = new Set<string>();
    for (const row of Array.isArray(data) ? data : []) {
      const s = (row as { skills?: unknown }).skills;
      if (Array.isArray(s)) {
        for (const k of s) {
          if (typeof k === 'string' && k) set.add(k);
        }
      }
    }
    return { skills: Array.from(set), error: null };
  } catch (err) {
    console.error('[getWorkerSkillsInUseForTenant]', err);
    return {
      skills: [],
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Paginated workers list for the admin workers page (full row shape).
 */
export async function getWorkersListForTenant(
  tenantId: string,
  filters: WorkersFilters & { page?: number }
): Promise<{ workers: AdminWorkerRow[]; totalCount: number; error: Error | null }> {
  try {
    const supabase = await createClient();
    const page = Math.max(1, filters.page ?? 1);
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from('workers')
      .select('*', { count: 'exact' })
      .eq('primary_tenant_id', tenantId);

    if (filters.search?.trim()) {
      const term = `%${filters.search.trim()}%`;
      query = query.or(`full_name.ilike.${term},phone.ilike.${term},email.ilike.${term}`);
    }

    if (filters.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
      if (statuses.length > 0) {
        query = query.in('status', statuses);
      }
    }

    if (filters.worker_type) {
      query = query.eq('worker_type', filters.worker_type);
    }

    const hasSkillsArr = Array.isArray(filters.has_skills)
      ? filters.has_skills
      : filters.has_skills
        ? [filters.has_skills]
        : [];
    if (hasSkillsArr.length > 0) {
      const orClause = hasSkillsArr
        .map((skill) => `skills.cs.${JSON.stringify([skill])}`)
        .join(',');
      query = query.or(orClause);
    }

    const sortCol = filters.sort ?? 'full_name';
    const sortAsc = filters.sort_dir !== 'desc';
    query = query.order(sortCol, { ascending: sortAsc, nullsFirst: false });

    query = query.range(from, to);

    const { data, error, count } = await query;

    if (error) {
      console.error('[getWorkersListForTenant]', error);
      return {
        workers: [],
        totalCount: 0,
        error: new Error(error.message ?? 'Failed to load workers'),
      };
    }

    const workers: AdminWorkerRow[] = (Array.isArray(data) ? data : []).map((row) =>
      mapAdminWorkerRow(row as Record<string, unknown>)
    );

    return {
      workers,
      totalCount: typeof count === 'number' ? count : 0,
      error: null,
    };
  } catch (err) {
    console.error('[getWorkersListForTenant]', err);
    return {
      workers: [],
      totalCount: 0,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}
