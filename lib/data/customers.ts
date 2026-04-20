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
}

/**
 * Fetches all customers for the tenant with job count, for the customers list page.
 * Supports search (name, email, phone) and type filter.
 */
export async function getCustomersForTenantList(
  tenantId: string,
  filters: CustomersListFilters = {}
): Promise<{ customers: CustomerListRow[]; error: Error | null }> {
  try {
    const supabase = await createClient();
    let query = supabase
      .from('customers')
      .select(
        'id, tenant_id, name, type, email, phone, notes, created_at, updated_at, jobs(count)'
      )
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true });

    if (filters.type) {
      query = query.eq('type', filters.type);
    }
    if (filters.search?.trim()) {
      const term = `%${filters.search.trim()}%`;
      query = query.or(
        `name.ilike.${term},email.ilike.${term},phone.ilike.${term}`
      );
    }

    const { data, error } = await query;

    if (error) {
      console.error('[getCustomersForTenantList]', error);
      return {
        customers: [],
        error: new Error(error.message ?? 'Failed to load customers'),
      };
    }

    const rows = Array.isArray(data) ? data : [];
    const customers: CustomerListRow[] = rows.map((row: Record<string, unknown>) => {
      const jobsRel = row.jobs as { count: number }[] | { count: number } | null;
      const jobCount = Array.isArray(jobsRel)
        ? jobsRel[0]?.count ?? 0
        : jobsRel && typeof jobsRel === 'object' && 'count' in jobsRel
          ? (jobsRel as { count: number }).count
          : 0;
      return {
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
      };
    });

    return { customers, error: null };
  } catch (err) {
    console.error('[getCustomersForTenantList]', err);
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
