import { createClient } from '@/lib/supabase/server';

export type JobStatus =
  | 'pending'
  | 'pending_send'
  | 'assigned'
  | 'in_progress'
  | 'completed'
  | 'cancelled';
export type JobPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface JobsFilters {
  search?: string;
  status?: JobStatus | JobStatus[];
  priority?: JobPriority;
  customer_id?: string;
  date_from?: string;
  date_to?: string;
  sort?: 'created_at' | 'reference_number' | 'status' | 'priority' | 'scheduled_date' | 'customer_name';
  sort_dir?: 'asc' | 'desc';
}

export interface JobRow {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  assigned_worker_id: string | null;
  reference_number: string | null;
  address: string | null;
  postcode?: string | null;
  job_description?: string | null;
  status: JobStatus | null;
  priority: JobPriority | null;
  scheduled_date: string | null;
  /** Time portion when scheduled (e.g. `14:30:00`). */
  scheduled_time: string | null;
  created_at: string;
  updated_at: string | null;
  customer_name: string | null;
  worker_name: string | null;
  required_skills?: string[];
  /** Last auto-assign failure message; cleared on successful assignment. */
  auto_assign_failure_reason?: string | null;
}

/** Dashboard-style counts for the jobs list summary bar (excludes cancelled). */
export interface JobsStatusSummary {
  notStarted: number;
  inProgress: number;
  paused: number;
  /** Assigned but not yet sent to worker app (`pending_send`). */
  readyToSend: number;
  completed: number;
}

export async function getJobsStatusSummary(tenantId: string): Promise<JobsStatusSummary> {
  const supabase = await createClient();
  const [notStarted, inProgress, paused, readyToSend, completed] = await Promise.all([
    supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'pending'),
    supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'in_progress'),
    supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'assigned'),
    supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'pending_send'),
    supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'completed'),
  ]);

  return {
    notStarted: notStarted.count ?? 0,
    inProgress: inProgress.count ?? 0,
    paused: paused.count ?? 0,
    readyToSend: readyToSend.count ?? 0,
    completed: completed.count ?? 0,
  };
}

export interface PendingSendJobRow {
  id: string;
  reference_number: string | null;
  worker_name: string | null;
}

export async function getPendingSendJobsForTenant(
  tenantId: string
): Promise<{ jobs: PendingSendJobRow[]; error: Error | null }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('jobs')
      .select(
        `
        id,
        reference_number,
        worker:workers!assigned_worker_id(full_name)
      `
      )
      .eq('tenant_id', tenantId)
      .eq('status', 'pending_send')
      .not('assigned_worker_id', 'is', null)
      .order('created_at', { ascending: true });

    if (error) {
      return { jobs: [], error: toError(error) };
    }

    const jobs: PendingSendJobRow[] = (Array.isArray(data) ? data : []).map((row: Record<string, unknown>) => {
      const worker = row.worker as { full_name?: string } | null;
      return {
        id: row.id as string,
        reference_number: (row.reference_number as string | null) ?? null,
        worker_name: worker?.full_name ?? null,
      };
    });

    return { jobs, error: null };
  } catch (err) {
    return { jobs: [], error: toError(err) };
  }
}

const PAGE_SIZE = 50;

function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return new Error((err as { message: string }).message);
  }
  return new Error(String(err));
}

/**
 * Fetches jobs for the given tenant with optional filters.
 * Uses Supabase with joins to customers and workers; RLS enforces tenant isolation.
 * Never throws - returns empty array and error on failure.
 */
export async function getJobsForTenant(
  tenantId: string,
  filters: JobsFilters & { page?: number }
): Promise<{ jobs: JobRow[]; totalCount: number; error: Error | null }> {
  try {
    const supabase = await createClient();
    const page = Math.max(1, filters.page ?? 1);
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    // Explicit FK hints prevent ambiguous aliases. Schema: customers.name, workers.full_name (no "name").
    let query = supabase
      .from('jobs')
      .select(
        `
      *,
      customer:customers!customer_id(id, name),
      worker:workers!assigned_worker_id(id, full_name)
    `,
        { count: 'exact' }
      )
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (filters.status) {
      if (Array.isArray(filters.status) && filters.status.length > 0) {
        query = query.in('status', filters.status);
      } else if (!Array.isArray(filters.status)) {
        query = query.eq('status', filters.status);
      }
    }
    if (filters.priority) {
      query = query.eq('priority', filters.priority);
    }
    if (filters.customer_id) {
      if (filters.customer_id === 'none') {
        query = query.is('customer_id', null);
      } else {
        query = query.eq('customer_id', filters.customer_id);
      }
    }
    if (filters.date_from) {
      query = query.gte('scheduled_date', filters.date_from);
    }
    if (filters.date_to) {
      query = query.lte('scheduled_date', filters.date_to);
    }
    if (filters.search?.trim()) {
      const term = filters.search.trim();
      query = query.or(
        `address.ilike.%${term}%,reference_number.ilike.%${term}%,job_description.ilike.%${term}%`
      );
    }
    const sortCol = filters.sort ?? 'created_at';
    const sortDir = filters.sort_dir === 'asc';
    if (sortCol === 'customer_name') {
      query = query.order('created_at', { ascending: sortDir });
    } else {
      query = query.order(sortCol, { ascending: sortDir });
    }

    const { data, error, count } = await query;

    if (error) {
      console.error('[getJobsForTenant] Supabase query error:', error);
      return {
        jobs: [],
        totalCount: 0,
        error: new Error(error.message ?? 'Failed to load jobs'),
      };
    }

    const jobs: JobRow[] = (Array.isArray(data) ? data : []).map((row: Record<string, unknown>) => {
      const customer = row.customer as { id?: string; name?: string } | null;
      const worker = row.worker as { id?: string; full_name?: string } | null;
      const requiredSkills = row.required_skills;
      return {
        id: row.id as string,
        tenant_id: row.tenant_id as string,
        customer_id: row.customer_id as string | null,
        assigned_worker_id: row.assigned_worker_id as string | null,
        reference_number: row.reference_number as string | null,
        address: row.address as string | null,
        postcode: (row.postcode as string | null) ?? null,
        job_description: (row.job_description as string | null) ?? null,
        status: row.status as JobRow['status'],
        priority: row.priority as JobRow['priority'],
        scheduled_date: row.scheduled_date as string | null,
        scheduled_time: (row.scheduled_time as string | null) ?? null,
        created_at: row.created_at as string,
        updated_at: row.updated_at as string | null,
        customer_name: customer?.name ?? null,
        worker_name: worker?.full_name ?? null,
        required_skills: Array.isArray(requiredSkills) ? (requiredSkills as string[]) : [],
      };
    });

    console.log('[getJobsForTenant] Jobs query result:', { count: jobs.length, totalCount: typeof count === 'number' ? count : 0 });
    return {
      jobs,
      totalCount: typeof count === 'number' ? count : 0,
      error: null,
    };
  } catch (err) {
    console.error('[getJobsForTenant] Unexpected error:', err);
    return {
      jobs: [],
      totalCount: 0,
      error: toError(err),
    };
  }
}

/**
 * Fetches jobs that need manual assignment (pending, no worker assigned).
 * Ordered by created_at ascending (oldest first) for review flow.
 */
export async function getUnassignedJobsForTenant(
  tenantId: string,
  limit = 100
): Promise<{ jobs: JobRow[]; error: Error | null }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('jobs')
      .select(
        `
      *,
      customer:customers!customer_id(id, name),
      worker:workers!assigned_worker_id(id, full_name)
    `
      )
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .is('assigned_worker_id', null)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) {
      console.error('[getUnassignedJobsForTenant]', error);
      return { jobs: [], error: new Error(error.message ?? 'Failed to load jobs') };
    }

    const jobs: JobRow[] = (Array.isArray(data) ? data : []).map((row: Record<string, unknown>) => {
      const customer = row.customer as { id?: string; name?: string } | null;
      const worker = row.worker as { id?: string; full_name?: string } | null;
      const requiredSkills = row.required_skills;
      return {
        id: row.id as string,
        tenant_id: row.tenant_id as string,
        customer_id: row.customer_id as string | null,
        assigned_worker_id: row.assigned_worker_id as string | null,
        reference_number: row.reference_number as string | null,
        address: row.address as string | null,
        postcode: (row.postcode as string | null) ?? null,
        job_description: (row.job_description as string | null) ?? null,
        status: row.status as JobRow['status'],
        priority: row.priority as JobRow['priority'],
        scheduled_date: row.scheduled_date as string | null,
        scheduled_time: (row.scheduled_time as string | null) ?? null,
        created_at: row.created_at as string,
        updated_at: row.updated_at as string | null,
        customer_name: customer?.name ?? null,
        worker_name: worker?.full_name ?? null,
        required_skills: Array.isArray(requiredSkills) ? (requiredSkills as string[]) : [],
        auto_assign_failure_reason:
          (row.auto_assign_failure_reason as string | null | undefined) ?? null,
      };
    });
    return { jobs, error: null };
  } catch (err) {
    console.error('[getUnassignedJobsForTenant]', err);
    return {
      jobs: [],
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

export interface CustomerJobCount {
  customer_id: string | null;
  name: string;
  count: number;
}

/**
 * Returns distinct customers that have jobs for this tenant, with job counts.
 * Used for the customer filter dropdown ("ABC Property Management (234 jobs)").
 */
export async function getCustomerJobCounts(
  tenantId: string
): Promise<{ customers: CustomerJobCount[]; error: Error | null }> {
  try {
    const supabase = await createClient();
    const { data: jobRows, error: jobsError } = await supabase
      .from('jobs')
      .select('customer_id')
      .eq('tenant_id', tenantId);

    if (jobsError) {
      console.error('[getCustomerJobCounts]', jobsError);
      return { customers: [], error: new Error(jobsError.message ?? 'Failed to load') };
    }

    const rows = Array.isArray(jobRows) ? jobRows : [];
    const countByCustomerId = new Map<string | null, number>();
    for (const row of rows) {
      const id = (row as { customer_id: string | null }).customer_id ?? null;
      countByCustomerId.set(id, (countByCustomerId.get(id) ?? 0) + 1);
    }

    const customerIds = [...countByCustomerId.keys()].filter((id): id is string => id != null);
    if (customerIds.length === 0) {
      const uncounted = countByCustomerId.get(null) ?? 0;
      return {
        customers: uncounted > 0 ? [{ customer_id: null, name: 'Individual / No customer', count: uncounted }] : [],
        error: null,
      };
    }

    const { data: customersData, error: custError } = await supabase
      .from('customers')
      .select('id, name')
      .in('id', customerIds);

    if (custError) {
      console.error('[getCustomerJobCounts] customers', custError);
      return { customers: [], error: new Error(custError.message ?? 'Failed to load customers') };
    }

    const nameById = new Map(
      (customersData ?? []).map((c: { id: string; name: string }) => [c.id, c.name ?? ''])
    );
    const customers: CustomerJobCount[] = customerIds.map((id) => ({
      customer_id: id,
      name: nameById.get(id) ?? 'Unknown',
      count: countByCustomerId.get(id) ?? 0,
    }));
    const nullCount = countByCustomerId.get(null) ?? 0;
    if (nullCount > 0) {
      customers.push({ customer_id: null, name: 'Individual / No customer', count: nullCount });
    }
    customers.sort((a, b) => b.count - a.count);
    return { customers, error: null };
  } catch (err) {
    console.error('[getCustomerJobCounts]', err);
    return {
      customers: [],
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Total jobs and completed count for a single customer (or no customer when filter is "none").
 * Used for "X of Y jobs completed" when the jobs list is filtered by customer.
 */
export async function getCustomerJobsCompletionSummary(
  tenantId: string,
  customerFilter: string
): Promise<{ total: number; completed: number; error: Error | null }> {
  try {
    const supabase = await createClient();
    const base = () => {
      let q = supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId);
      if (customerFilter === 'none') {
        q = q.is('customer_id', null);
      } else {
        q = q.eq('customer_id', customerFilter);
      }
      return q;
    };

    const [{ count: total, error: totalErr }, { count: completed, error: completedErr }] =
      await Promise.all([
        base(),
        (() => {
          let q = supabase
            .from('jobs')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', tenantId)
            .eq('status', 'completed');
          if (customerFilter === 'none') {
            q = q.is('customer_id', null);
          } else {
            q = q.eq('customer_id', customerFilter);
          }
          return q;
        })(),
      ]);

    if (totalErr) {
      console.error('[getCustomerJobsCompletionSummary] total', totalErr);
      return {
        total: 0,
        completed: 0,
        error: new Error(totalErr.message ?? 'Failed to load job counts'),
      };
    }
    if (completedErr) {
      console.error('[getCustomerJobsCompletionSummary] completed', completedErr);
      return {
        total: 0,
        completed: 0,
        error: new Error(completedErr.message ?? 'Failed to load job counts'),
      };
    }

    return {
      total: total ?? 0,
      completed: completed ?? 0,
      error: null,
    };
  } catch (err) {
    console.error('[getCustomerJobsCompletionSummary]', err);
    return {
      total: 0,
      completed: 0,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

export interface RecentJobRow {
  id: string;
  reference_number: string | null;
  address: string | null;
  status: JobStatus | null;
  created_at: string;
}

/**
 * Last N jobs for a customer (for customer detail page).
 */
export async function getRecentJobsForCustomer(
  tenantId: string,
  customerId: string,
  limit = 10
): Promise<{ jobs: RecentJobRow[]; error: Error | null }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('jobs')
      .select('id, reference_number, address, status, created_at')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[getRecentJobsForCustomer]', error);
      return { jobs: [], error: new Error(error.message ?? 'Failed to load jobs') };
    }

    const jobs: RecentJobRow[] = (Array.isArray(data) ? data : []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      reference_number: row.reference_number as string | null,
      address: row.address as string | null,
      status: row.status as JobStatus | null,
      created_at: row.created_at as string,
    }));
    return { jobs, error: null };
  } catch (err) {
    console.error('[getRecentJobsForCustomer]', err);
    return {
      jobs: [],
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}
