import { createClient } from '@/lib/supabase/server';

export type CustomerType = 'individual' | 'bulk_client' | string;

export interface CustomerRow {
  id: string;
  name: string;
  type: CustomerType;
}

export interface CustomerListRow extends CustomerRow {
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  tenant_id: string;
  created_at?: string;
  updated_at?: string | null;
  job_count: number;
  has_portal_access: boolean;
}

export interface InactiveCustomerRow {
  id: string;
  name: string;
  email: string | null;
  type: CustomerType;
  job_count: number;
  updated_at: string | null;
}

export interface CustomerDetailRow extends CustomerListRow {
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
}

export interface CustomerJobStats {
  total: number;
  pending: number;
  assigned: number;
  in_progress: number;
  completed: number;
  cancelled: number;
}

export interface CustomerImportOption {
  id: string;
  name: string;
}

/**
 * Active customers for the import wizard dropdown (id + name, ordered by name).
 */
export async function getCustomersForImport(
  tenantId: string
): Promise<{ customers: CustomerImportOption[]; error: Error | null }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('customers')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('name');

    if (error) {
      console.error('[getCustomersForImport]', error);
      return { customers: [], error: new Error(error.message ?? 'Failed to load customers') };
    }

    const customers: CustomerImportOption[] = (Array.isArray(data) ? data : []).map(
      (row: { id: string; name: string }) => ({
        id: row.id,
        name: row.name ?? '',
      })
    );
    return { customers, error: null };
  } catch (err) {
    console.error('[getCustomersForImport]', err);
    return {
      customers: [],
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Fetches customers for the given tenant (for dropdowns, etc.).
 * Returns id, name, type. Never throws - returns empty array on error.
 */
export async function getCustomersForTenant(
  tenantId: string
): Promise<{ customers: CustomerRow[]; error: Error | null }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('customers')
      .select('id, name, type')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('name');

    if (error) {
      console.error('[getCustomersForTenant]', error);
      return { customers: [], error: new Error(error.message ?? 'Failed to load customers') };
    }

    const customers: CustomerRow[] = (Array.isArray(data) ? data : []).map(
      (row: { id: string; name: string; type?: string }) => ({
        id: row.id,
        name: row.name ?? '',
        type: (row.type as CustomerType) ?? 'individual',
      })
    );
    return { customers, error: null };
  } catch (err) {
    console.error('[getCustomersForTenant]', err);
    return {
      customers: [],
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

export interface CustomersListFilters {
  search?: string;
  type?: 'bulk_client' | 'individual';
  sort?: 'name' | 'email' | 'jobs';
  sort_dir?: 'asc' | 'desc';
}

const PAGE_SIZE = 50;

/**
 * Paginated active customers with job counts (via customers_with_job_counts view).
 * Requires `is_active` on the view (see migration customers_with_job_counts_is_active).
 */
export async function getCustomersForTenantList(
  tenantId: string,
  filters: CustomersListFilters & { page?: number } = {}
): Promise<{ customers: CustomerListRow[]; totalCount: number; error: Error | null }> {
  try {
    const supabase = await createClient();
    const page = Math.max(1, filters.page ?? 1);
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from('customers_with_job_counts')
      .select('id, tenant_id, name, type, email, phone, notes, created_at, updated_at, job_count', {
        count: 'exact',
      })
      .eq('tenant_id', tenantId)
      .eq('is_active', true);

    if (filters.type) {
      query = query.eq('type', filters.type);
    }
    if (filters.search?.trim()) {
      const term = `%${filters.search.trim()}%`;
      query = query.or(
        `name.ilike.${term},email.ilike.${term},phone.ilike.${term}`
      );
    }

    const sortCol = filters.sort ?? 'name';
    const sortAsc = filters.sort_dir !== 'desc';
    if (sortCol === 'email') {
      query = query.order('email', { ascending: sortAsc, nullsFirst: false });
    } else if (sortCol === 'jobs') {
      query = query.order('job_count', { ascending: sortAsc, nullsFirst: false });
    } else {
      query = query.order('name', { ascending: sortAsc, nullsFirst: false });
    }

    query = query.range(from, to);

    const { data, error, count } = await query;

    if (error) {
      console.error('[getCustomersForTenantList]', error);
      return {
        customers: [],
        totalCount: 0,
        error: new Error(error.message ?? 'Failed to load customers'),
      };
    }

    const rows = Array.isArray(data) ? data : [];
    const customerIds = rows.map((row) => String((row as Record<string, unknown>).id));

    const portalCustomerIds = new Set<string>();
    if (customerIds.length > 0) {
      const { data: portalRows, error: portalError } = await supabase
        .from('customer_portal_users')
        .select('customer_id')
        .in('customer_id', customerIds);

      if (portalError) {
        console.error('[getCustomersForTenantList] portal access:', portalError);
      } else {
        for (const portalRow of Array.isArray(portalRows) ? portalRows : []) {
          portalCustomerIds.add(String(portalRow.customer_id));
        }
      }
    }

    const customers: CustomerListRow[] = rows.map((row: Record<string, unknown>) => {
      const jobCount = row.job_count;
      const id = row.id as string;
      return {
        id,
        tenant_id: row.tenant_id as string,
        name: (row.name as string) ?? '',
        type: (row.type as CustomerType) ?? 'individual',
        email: (row.email as string | null) ?? null,
        phone: (row.phone as string | null) ?? null,
        address: null,
        notes: (row.notes as string | null) ?? null,
        created_at: row.created_at as string | undefined,
        updated_at: row.updated_at as string | null | undefined,
        job_count: typeof jobCount === 'number' ? jobCount : 0,
        has_portal_access: portalCustomerIds.has(id),
      };
    });

    return {
      customers,
      totalCount: typeof count === 'number' ? count : 0,
      error: null,
    };
  } catch (err) {
    console.error('[getCustomersForTenantList]', err);
    return {
      customers: [],
      totalCount: 0,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Inactive customers for the tenant (is_active = false), ordered by name.
 */
export async function getInactiveCustomersForTenant(
  tenantId: string
): Promise<{ customers: InactiveCustomerRow[]; error: Error | null }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('customers')
      .select('id, name, email, type, updated_at, jobs(count)')
      .eq('tenant_id', tenantId)
      .eq('is_active', false)
      .order('name');

    if (error) {
      console.error('[getInactiveCustomersForTenant]', error);
      return {
        customers: [],
        error: new Error(error.message ?? 'Failed to load inactive customers'),
      };
    }

    const customers: InactiveCustomerRow[] = (Array.isArray(data) ? data : []).map((row) => {
      const record = row as Record<string, unknown>;
      const jobsRel = record.jobs as { count: number }[] | { count: number } | null;
      const jobCount = Array.isArray(jobsRel)
        ? jobsRel[0]?.count ?? 0
        : jobsRel && typeof jobsRel === 'object' && 'count' in jobsRel
          ? (jobsRel as { count: number }).count
          : 0;

      return {
        id: String(record.id),
        name: String(record.name ?? ''),
        email: record.email != null ? String(record.email) : null,
        type: (record.type as CustomerType) ?? 'individual',
        job_count: typeof jobCount === 'number' ? jobCount : 0,
        updated_at: record.updated_at != null ? String(record.updated_at) : null,
      };
    });

    return { customers, error: null };
  } catch (err) {
    console.error('[getInactiveCustomersForTenant]', err);
    return {
      customers: [],
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Fetches a single customer by ID for the current tenant.
 */
export async function getCustomerById(
  tenantId: string,
  customerId: string
): Promise<{ customer: CustomerDetailRow | null; error: Error | null }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('customers')
      .select('id, tenant_id, name, type, email, phone, notes, created_at, updated_at, jobs(count)')
      .eq('id', customerId)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !data) {
      if (error?.code === 'PGRST116') return { customer: null, error: null };
      console.error('[getCustomerById]', error);
      return {
        customer: null,
        error: new Error(error?.message ?? 'Failed to load customer'),
      };
    }

    const row = data as Record<string, unknown>;
    const jobsRel = row.jobs as { count: number }[] | { count: number } | null;
    const jobCount = Array.isArray(jobsRel)
      ? jobsRel[0]?.count ?? 0
      : jobsRel && typeof jobsRel === 'object' && 'count' in jobsRel
        ? (jobsRel as { count: number }).count
        : 0;

    const { data: portalRow } = await supabase
      .from('customer_portal_users')
      .select('customer_id')
      .eq('customer_id', customerId)
      .limit(1)
      .maybeSingle();

    const customer: CustomerDetailRow = {
      id: row.id as string,
      tenant_id: row.tenant_id as string,
      name: (row.name as string) ?? '',
      type: (row.type as CustomerType) ?? 'individual',
      email: (row.email as string | null) ?? null,
      phone: (row.phone as string | null) ?? null,
      address: null,
      notes: (row.notes as string | null) ?? null,
      created_at: row.created_at as string | undefined,
      updated_at: row.updated_at as string | null | undefined,
      job_count: typeof jobCount === 'number' ? jobCount : 0,
      has_portal_access: !!portalRow,
    };
    return { customer, error: null };
  } catch (err) {
    console.error('[getCustomerById]', err);
    return {
      customer: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Fetches job stats (count by status) for a customer.
 */
export async function getCustomerJobStats(
  tenantId: string,
  customerId: string
): Promise<{ stats: CustomerJobStats; error: Error | null }> {
  const defaultStats: CustomerJobStats = {
    total: 0,
    pending: 0,
    assigned: 0,
    in_progress: 0,
    completed: 0,
    cancelled: 0,
  };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('jobs')
      .select('status')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId);

    if (error) {
      console.error('[getCustomerJobStats]', error);
      return { stats: defaultStats, error: new Error(error.message ?? 'Failed to load stats') };
    }

    const rows = Array.isArray(data) ? data : [];
    const stats: CustomerJobStats = { ...defaultStats, total: rows.length };
    const statusKeys: (keyof Omit<CustomerJobStats, 'total'>)[] = [
      'pending',
      'assigned',
      'in_progress',
      'completed',
      'cancelled',
    ];
    for (const row of rows) {
      const s = (row as { status: string }).status;
      if (statusKeys.includes(s as keyof Omit<CustomerJobStats, 'total'>)) {
        stats[s as keyof Omit<CustomerJobStats, 'total'>] += 1;
      }
    }
    return { stats, error: null };
  } catch (err) {
    console.error('[getCustomerJobStats]', err);
    return { stats: defaultStats, error: err instanceof Error ? err : new Error(String(err)) };
  }
}
