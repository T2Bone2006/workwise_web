import { createClient } from '@/lib/supabase/server';
import {
  mergeFieldsWithHeaders,
  parseWorkerVisibleFields,
  type WorkerVisibleField,
} from '@/lib/jobs/worker-visible-fields';

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

export interface CustomerWorkerFields {
  /** Stored config merged with headers actually present in this customer's jobs. */
  fields: WorkerVisibleField[];
  /** Keys seen in the jobs but not yet in the stored config. */
  newKeys: string[];
  /** True when nothing has ever been configured, i.e. every field is showing. */
  neverConfigured: boolean;
}

/** Most recent jobs scanned for spreadsheet headers. Plenty for one sheet. */
const HEADER_SAMPLE_SIZE = 200;

/**
 * The field picker for one customer: what is configured, plus every column
 * their imports have actually produced.
 *
 * Headers come from the jobs themselves rather than a stored header list, so a
 * column added to next month's spreadsheet appears on its own with nothing to
 * wire up in the import path.
 */
export async function getCustomerWorkerFields(
  tenantId: string,
  customerId: string
): Promise<{ data: CustomerWorkerFields; error: Error | null }> {
  const empty: CustomerWorkerFields = {
    fields: [],
    newKeys: [],
    neverConfigured: true,
  };
  try {
    const supabase = await createClient();

    const [customerResult, jobsResult] = await Promise.all([
      supabase
        .from('customers')
        .select('worker_visible_fields')
        .eq('id', customerId)
        .eq('tenant_id', tenantId)
        .single(),
      supabase
        .from('jobs')
        .select('source_fields')
        .eq('tenant_id', tenantId)
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(HEADER_SAMPLE_SIZE),
    ]);

    if (customerResult.error) {
      console.error('[getCustomerWorkerFields] customer', customerResult.error);
      return { data: empty, error: new Error(customerResult.error.message) };
    }
    if (jobsResult.error) {
      console.error('[getCustomerWorkerFields] jobs', jobsResult.error);
      return { data: empty, error: new Error(jobsResult.error.message) };
    }

    const stored = parseWorkerVisibleFields(
      (customerResult.data as { worker_visible_fields?: unknown } | null)
        ?.worker_visible_fields
    );

    const headers: string[] = [];
    const seen = new Set<string>();
    for (const row of jobsResult.data ?? []) {
      const sourceFields = (row as { source_fields?: unknown }).source_fields;
      if (!sourceFields || typeof sourceFields !== 'object' || Array.isArray(sourceFields)) {
        continue;
      }
      for (const header of Object.keys(sourceFields as Record<string, unknown>)) {
        const trimmed = header.trim();
        if (!trimmed || seen.has(trimmed)) continue;
        seen.add(trimmed);
        headers.push(trimmed);
      }
    }
    headers.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    const { fields, newKeys } = mergeFieldsWithHeaders(stored, headers);

    return {
      data: {
        fields,
        newKeys: [...newKeys],
        neverConfigured: stored == null,
      },
      error: null,
    };
  } catch (err) {
    console.error('[getCustomerWorkerFields]', err);
    return {
      data: empty,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
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
  import_column_mapping: Record<string, string> | null;
  import_value_transforms: Record<string, Record<string, string>>;
  import_expected_headers: string[];
}

/**
 * Active customers for the import wizard dropdown (id + name + import profile).
 */
export async function getCustomersForImport(
  tenantId: string
): Promise<{ customers: CustomerImportOption[]; error: Error | null }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('customers')
      .select(
        'id, name, import_column_mapping, import_value_transforms, import_expected_headers'
      )
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('name');

    if (error) {
      console.error('[getCustomersForImport]', error);
      return { customers: [], error: new Error(error.message ?? 'Failed to load customers') };
    }

    const customers: CustomerImportOption[] = (Array.isArray(data) ? data : []).map(
      (row: {
        id: string;
        name: string;
        import_column_mapping: unknown;
        import_value_transforms: unknown;
        import_expected_headers: unknown;
      }) => ({
        id: row.id,
        name: row.name ?? '',
        import_column_mapping:
          (row.import_column_mapping as Record<string, string> | null) ?? null,
        import_value_transforms:
          (row.import_value_transforms as Record<string, Record<string, string>>) ?? {},
        import_expected_headers: Array.isArray(row.import_expected_headers)
          ? (row.import_expected_headers as string[])
          : [],
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
