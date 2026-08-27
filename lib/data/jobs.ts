import { createClient } from '@/lib/supabase/server';
import { EXPORT_MAX_ROWS } from '@/lib/jobs/export-limits';
import {
  buildJobsSearchOrFilter,
  computeJobMatchPills,
  parseSourceFields,
  type JobMatchPill,
} from '@/lib/jobs/job-search-matches';
import {
  decodeSourceFieldFilter,
  fieldFilterPillLabel,
  isSourceFieldFilter,
  type FieldFilterValueOption,
  type SystemFilterFieldKey,
} from '@/lib/jobs/field-filter';
import { JOB_STATUS_DISPLAY } from '@/lib/job-status-display';

export type { JobMatchPill };

export type JobStatus =
  | 'pending'
  | 'pending_send'
  | 'assigned'
  | 'in_progress'
  | 'paused'
  | 'completed'
  | 'declined'
  | 'cancelled';
export type JobPriority = 'low' | 'normal' | 'high' | 'emergency';

export interface JobsFilters {
  search?: string;
  status?: JobStatus | JobStatus[];
  priority?: JobPriority;
  customer_id?: string;
  import_source_id?: string;
  date_from?: string;
  date_to?: string;
  /**
   * Phase 6+: stacked Where/Is filters (AND).
   * URL: f0/v0, f1/v1, … (legacy field/value maps to f0/v0).
   */
  field_filters?: Array<{ field: string; value: string }>;
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
  /** Extra spreadsheet columns from import (not always selected for display). */
  source_fields?: Record<string, string>;
  /** Why this row matched the active search (Phase 5). */
  match_pills?: JobMatchPill[];
}

/** JobRow plus lifecycle timestamps/notes needed for export — not fetched by the paginated list query. */
export interface ExportJobRow extends JobRow {
  started_at: string | null;
  arrived_at: string | null;
  completed_at: string | null;
  completion_notes: string | null;
}

/** Dashboard-style counts for the jobs list summary bar (excludes cancelled). */
export interface JobsStatusSummary {
  notStarted: number;
  inProgress: number;
  /** Worker paused an in-progress job (`paused`). */
  paused: number;
  /** Assigned to a worker, not yet started (`assigned`). */
  assigned: number;
  /** Assigned but not yet sent to worker app (`pending_send`). */
  readyToSend: number;
  completed: number;
}

export async function getJobsStatusSummary(tenantId: string): Promise<JobsStatusSummary> {
  const supabase = await createClient();
  const [notStarted, inProgress, paused, assigned, readyToSend, completed] = await Promise.all([
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
      .eq('status', 'paused'),
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
    assigned: assigned.count ?? 0,
    readyToSend: readyToSend.count ?? 0,
    completed: completed.count ?? 0,
  };
}

export interface PendingSendJobRow {
  id: string;
  reference_number: string | null;
  worker_name: string | null;
  job_description: string | null;
  address: string | null;
  postcode: string | null;
  required_skills: string[];
  source_fields: Record<string, string>;
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
        job_description,
        address,
        postcode,
        required_skills,
        source_fields,
        worker:workers!assigned_worker_id(full_name)
      `
      )
      .eq('tenant_id', tenantId)
      .eq('status', 'pending_send')
      .not('assigned_worker_id', 'is', null)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });

    if (error) {
      return { jobs: [], error: toError(error) };
    }

    const jobs: PendingSendJobRow[] = (Array.isArray(data) ? data : []).map((row: Record<string, unknown>) => {
      const worker = row.worker as { full_name?: string } | null;
      return {
        id: row.id as string,
        reference_number: (row.reference_number as string | null) ?? null,
        worker_name: worker?.full_name ?? null,
        job_description: (row.job_description as string | null) ?? null,
        address: (row.address as string | null) ?? null,
        postcode: (row.postcode as string | null) ?? null,
        required_skills: Array.isArray(row.required_skills)
          ? (row.required_skills as string[])
          : [],
        source_fields: parseSourceFields(row.source_fields),
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JobsQuery = any;

/** Applies the shared status/priority/customer/date/search filters used by both the paginated list and export. */
function applyJobsFilters(query: JobsQuery, filters: JobsFilters): JobsQuery {
  let q = query;
  if (filters.status) {
    if (Array.isArray(filters.status) && filters.status.length > 0) {
      q = q.in('status', filters.status);
    } else if (!Array.isArray(filters.status)) {
      q = q.eq('status', filters.status);
    }
  }
  if (filters.priority) {
    q = q.eq('priority', filters.priority);
  }
  if (filters.customer_id) {
    if (filters.customer_id === 'none') {
      q = q.is('customer_id', null);
    } else {
      q = q.eq('customer_id', filters.customer_id);
    }
  }
  if (filters.import_source_id) {
    if (filters.import_source_id === 'ungrouped') {
      q = q.is('import_source_id', null);
    } else {
      q = q.eq('import_source_id', filters.import_source_id);
    }
  }
  if (filters.date_from) {
    q = q.gte('scheduled_date', filters.date_from);
  }
  if (filters.date_to) {
    q = q.lte('scheduled_date', filters.date_to);
  }
  if (filters.search?.trim()) {
    const orFilter = buildJobsSearchOrFilter(filters.search);
    if (orFilter) {
      q = q.or(orFilter);
    }
  }

  const fieldFilters = filters.field_filters ?? [];
  for (const { field, value } of fieldFilters) {
    if (!field?.trim() || value == null || value === '') continue;
    q = applyFieldValueFilter(q, field.trim(), value);
  }
  return q;
}

function applyFieldValueFilter(query: JobsQuery, field: string, value: string): JobsQuery {
  if (isSourceFieldFilter(field)) {
    const key = decodeSourceFieldFilter(field);
    if (!key) return query;
    return query.contains('source_fields', { [key]: value });
  }

  switch (field as SystemFilterFieldKey) {
    case 'status':
      return query.eq('status', value);
    case 'priority':
      return query.eq('priority', value);
    case 'customer_id':
      if (value === 'none') return query.is('customer_id', null);
      return query.eq('customer_id', value);
    case 'assigned_worker_id':
      if (value === 'none') return query.is('assigned_worker_id', null);
      return query.eq('assigned_worker_id', value);
    case 'postcode':
      return query.eq('postcode', value);
    default:
      return query;
  }
}

/** Primary column from filters, then `id` so tied timestamps (e.g. an import batch) stay in a fixed order. */
function applyJobsListSort(query: JobsQuery, filters: JobsFilters): JobsQuery {
  const sortCol =
    filters.sort && filters.sort !== 'customer_name' ? filters.sort : 'created_at';
  const ascending = filters.sort_dir === 'asc';
  return query.order(sortCol, { ascending }).order('id', { ascending: false });
}

function mapJobRow(row: Record<string, unknown>, filters?: JobsFilters): JobRow {
  const customer = row.customer as { id?: string; name?: string } | null;
  const worker = row.worker as { id?: string; full_name?: string } | null;
  const requiredSkills = row.required_skills;
  const sourceFields = parseSourceFields(row.source_fields);
  const reference_number = row.reference_number as string | null;
  const address = row.address as string | null;
  const postcode = (row.postcode as string | null) ?? null;
  const job_description = (row.job_description as string | null) ?? null;
  const customer_name = customer?.name ?? null;
  const worker_name = worker?.full_name ?? null;
  const status = row.status as JobRow['status'];
  const priority = row.priority as JobRow['priority'];

  const mapped: JobRow = {
    id: row.id as string,
    tenant_id: row.tenant_id as string,
    customer_id: row.customer_id as string | null,
    assigned_worker_id: row.assigned_worker_id as string | null,
    reference_number,
    address,
    postcode,
    job_description,
    status,
    priority,
    scheduled_date: row.scheduled_date as string | null,
    scheduled_time: (row.scheduled_time as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string | null,
    customer_name,
    worker_name,
    required_skills: Array.isArray(requiredSkills) ? (requiredSkills as string[]) : [],
    source_fields: sourceFields,
  };

  if (filters?.search?.trim()) {
    mapped.match_pills = computeJobMatchPills({
      search: filters.search,
      reference_number,
      address,
      postcode,
      job_description,
      customer_name,
      worker_name,
      source_fields: sourceFields,
    });
  } else if (filters?.field_filters && filters.field_filters.length > 0) {
    const pills = filters.field_filters
      .map((f) => pillForActiveFieldFilter(mapped, f.field, f.value))
      .filter((p): p is JobMatchPill => !!p)
      .slice(0, 3);
    if (pills.length > 0) mapped.match_pills = pills;
  }

  return mapped;
}

function pillForActiveFieldFilter(
  job: JobRow,
  field: string,
  value: string
): JobMatchPill | null {
  if (isSourceFieldFilter(field)) {
    const key = decodeSourceFieldFilter(field);
    if (!key) return null;
    const actual = job.source_fields?.[key];
    if (actual == null || actual === '') return null;
    return { label: `${key}: ${actual}` };
  }

  switch (field as SystemFilterFieldKey) {
    case 'status': {
      const label =
        value in JOB_STATUS_DISPLAY
          ? JOB_STATUS_DISPLAY[value as keyof typeof JOB_STATUS_DISPLAY].label
          : value;
      return { label: fieldFilterPillLabel(field, label) };
    }
    case 'priority':
      return { label: fieldFilterPillLabel(field, value) };
    case 'customer_id':
      return {
        label: fieldFilterPillLabel(
          field,
          value === 'none' ? 'No customer' : (job.customer_name ?? value)
        ),
      };
    case 'assigned_worker_id':
      return {
        label: fieldFilterPillLabel(
          field,
          value === 'none' ? 'Unassigned' : (job.worker_name ?? value)
        ),
      };
    case 'postcode':
      return { label: fieldFilterPillLabel(field, job.postcode ?? value) };
    default:
      return { label: fieldFilterPillLabel(field, value) };
  }
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
      .range(from, to);

    query = applyJobsFilters(query, filters);
    query = applyJobsListSort(query, filters);

    const { data, error, count } = await query;

    if (error) {
      console.error('[getJobsForTenant] Supabase query error:', error);
      return {
        jobs: [],
        totalCount: 0,
        error: new Error(error.message ?? 'Failed to load jobs'),
      };
    }

    const jobs: JobRow[] = (Array.isArray(data) ? data : []).map((row) =>
      mapJobRow(row as Record<string, unknown>, filters)
    );

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
 * Fetches jobs for export — same filters/sort as the jobs list, but uncapped by the
 * page-size pagination and including lifecycle fields the list view doesn't need.
 * `limit` is clamped to `EXPORT_MAX_ROWS`; pass `undefined` to export all matching rows
 * (still capped).
 */
export async function getJobsForExport(
  tenantId: string,
  filters: JobsFilters,
  limit?: number
): Promise<{ jobs: ExportJobRow[]; error: Error | null }> {
  try {
    const supabase = await createClient();
    const cappedLimit = Math.min(limit && limit > 0 ? limit : EXPORT_MAX_ROWS, EXPORT_MAX_ROWS);

    let query = supabase
      .from('jobs')
      .select(
        `
      *,
      customer:customers!customer_id(id, name),
      worker:workers!assigned_worker_id(id, full_name)
    `
      )
      .eq('tenant_id', tenantId)
      .range(0, cappedLimit - 1);

    query = applyJobsFilters(query, filters);
    query = applyJobsListSort(query, filters);

    const { data, error } = await query;

    if (error) {
      console.error('[getJobsForExport] Supabase query error:', error);
      return { jobs: [], error: new Error(error.message ?? 'Failed to load jobs for export') };
    }

    const jobs: ExportJobRow[] = (Array.isArray(data) ? data : []).map(
      (row: Record<string, unknown>) => ({
        ...mapJobRow(row),
        started_at: (row.started_at as string | null) ?? null,
        arrived_at: (row.arrived_at as string | null) ?? null,
        completed_at: (row.completed_at as string | null) ?? null,
        completion_notes: (row.completion_notes as string | null) ?? null,
      })
    );

    return { jobs, error: null };
  } catch (err) {
    console.error('[getJobsForExport] Unexpected error:', err);
    return { jobs: [], error: toError(err) };
  }
}

/**
 * Fetches jobs that need manual assignment (pending, no worker assigned).
 * Excludes jobs dispatched to a network partner (`network_dispatch_id` set).
 * Ordered by created_at ascending (oldest first) for review flow.
 */
/**
 * Count of jobs awaiting review, without transferring any rows.
 * Use this instead of `getUnassignedJobsForTenant(...).jobs.length` — the
 * banner only needs the number, and fetching the rows to count them pulls
 * hundreds of joined records per page load.
 */
export async function getUnassignedJobsCountForTenant(
  tenantId: string
): Promise<{ count: number; error: Error | null }> {
  try {
    const supabase = await createClient();
    const { count, error } = await supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .is('assigned_worker_id', null)
      .is('network_dispatch_id', null);

    if (error) {
      console.error('[getUnassignedJobsCountForTenant]', error);
      return { count: 0, error: new Error(error.message ?? 'Failed to count jobs') };
    }

    return { count: count ?? 0, error: null };
  } catch (err) {
    console.error('[getUnassignedJobsCountForTenant]', err);
    return { count: 0, error: err instanceof Error ? err : new Error('Failed to count jobs') };
  }
}

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
      .is('network_dispatch_id', null)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
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

export interface ImportBatchRow {
  id: string;
  file_name: string | null;
  started_at: string | null;
  rows_imported: number;
  import_source_id: string | null;
  pending: number;
  pending_send: number;
  assigned: number;
  in_progress: number;
  paused: number;
  completed: number;
}

export async function getImportBatchesForTenant(
  tenantId: string
): Promise<{ batches: ImportBatchRow[]; error: Error | null }> {
  try {
    const supabase = await createClient();
    const { data: historyRows, error: historyError } = await supabase
      .from('import_history')
      .select('id, file_name, started_at, rows_imported, import_source_id')
      .eq('tenant_id', tenantId)
      .order('started_at', { ascending: false });

    if (historyError) {
      console.error('[getImportBatchesForTenant] import_history', historyError);
      return { batches: [], error: new Error(historyError.message ?? 'Failed to load import batches') };
    }

    const rows = Array.isArray(historyRows) ? historyRows : [];
    const importSourceIds = rows
      .map((row) => (row as { import_source_id?: string | null }).import_source_id ?? null)
      .filter((id): id is string => !!id);

    const countsBySource = new Map<
      string,
      {
        pending: number;
        pending_send: number;
        assigned: number;
        in_progress: number;
        paused: number;
        completed: number;
      }
    >();

    if (importSourceIds.length > 0) {
      const { data: jobRows, error: jobsError } = await supabase
        .from('jobs')
        .select('import_source_id, status')
        .eq('tenant_id', tenantId)
        .in('import_source_id', importSourceIds)
        .in('status', ['pending', 'pending_send', 'assigned', 'in_progress', 'paused', 'completed']);

      if (jobsError) {
        console.error('[getImportBatchesForTenant] jobs', jobsError);
        return { batches: [], error: new Error(jobsError.message ?? 'Failed to load import batch counts') };
      }

      for (const row of Array.isArray(jobRows) ? jobRows : []) {
        const sourceId = (row as { import_source_id?: string | null }).import_source_id ?? null;
        const status = (row as { status?: JobStatus | null }).status ?? null;
        if (!sourceId || !status) continue;
        if (!countsBySource.has(sourceId)) {
          countsBySource.set(sourceId, {
            pending: 0,
            pending_send: 0,
            assigned: 0,
            in_progress: 0,
            paused: 0,
            completed: 0,
          });
        }
        const counts = countsBySource.get(sourceId)!;
        if (status === 'pending') counts.pending += 1;
        if (status === 'pending_send') counts.pending_send += 1;
        if (status === 'assigned') counts.assigned += 1;
        if (status === 'in_progress') counts.in_progress += 1;
        if (status === 'paused') counts.paused += 1;
        if (status === 'completed') counts.completed += 1;
      }
    }

    const { data: ungroupedRows, error: ungroupedError } = await supabase
      .from('jobs')
      .select('status')
      .eq('tenant_id', tenantId)
      .is('import_source_id', null)
      .in('status', ['pending', 'pending_send', 'assigned', 'in_progress', 'paused', 'completed']);

    if (ungroupedError) {
      console.error('[getImportBatchesForTenant] ungrouped jobs', ungroupedError);
      return { batches: [], error: new Error(ungroupedError.message ?? 'Failed to load ungrouped job counts') };
    }

    const ungroupedCounts = {
      pending: 0,
      pending_send: 0,
      assigned: 0,
      in_progress: 0,
      paused: 0,
      completed: 0,
    };
    for (const row of Array.isArray(ungroupedRows) ? ungroupedRows : []) {
      const status = (row as { status?: JobStatus | null }).status ?? null;
      if (!status) continue;
      if (status === 'pending') ungroupedCounts.pending += 1;
      if (status === 'pending_send') ungroupedCounts.pending_send += 1;
      if (status === 'assigned') ungroupedCounts.assigned += 1;
      if (status === 'in_progress') ungroupedCounts.in_progress += 1;
      if (status === 'paused') ungroupedCounts.paused += 1;
      if (status === 'completed') ungroupedCounts.completed += 1;
    }

    const emptyCounts = {
      pending: 0,
      pending_send: 0,
      assigned: 0,
      in_progress: 0,
      paused: 0,
      completed: 0,
    };

    const liveJobTotal = (counts: {
      pending: number;
      pending_send: number;
      assigned: number;
      in_progress: number;
      paused: number;
      completed: number;
    }) =>
      counts.pending +
      counts.pending_send +
      counts.assigned +
      counts.in_progress +
      counts.paused +
      counts.completed;

    // Drop import batches with no remaining jobs (history row kept for audit).
    const batches: ImportBatchRow[] = rows
      .map((row) => {
        const r = row as {
          id: string;
          file_name?: string | null;
          started_at?: string | null;
          rows_imported?: number | null;
          import_source_id?: string | null;
        };
        const sourceId = r.import_source_id ?? null;
        const counts = sourceId
          ? countsBySource.get(sourceId) ?? emptyCounts
          : emptyCounts;
        return {
          id: r.id,
          file_name: r.file_name ?? null,
          started_at: r.started_at ?? null,
          rows_imported: typeof r.rows_imported === 'number' ? r.rows_imported : 0,
          import_source_id: sourceId,
          pending: counts.pending,
          pending_send: counts.pending_send,
          assigned: counts.assigned,
          in_progress: counts.in_progress,
          paused: counts.paused,
          completed: counts.completed,
        };
      })
      .filter((batch) => liveJobTotal(batch) > 0);

    const ungroupedTotal = liveJobTotal(ungroupedCounts);
    if (ungroupedTotal > 0) {
      batches.push({
        id: 'ungrouped',
        file_name: 'Manual & ungrouped jobs',
        started_at: null,
        rows_imported: ungroupedTotal,
        import_source_id: null,
        pending: ungroupedCounts.pending,
        pending_send: ungroupedCounts.pending_send,
        assigned: ungroupedCounts.assigned,
        in_progress: ungroupedCounts.in_progress,
        paused: ungroupedCounts.paused,
        completed: ungroupedCounts.completed,
      });
    }

    return { batches, error: null };
  } catch (err) {
    console.error('[getImportBatchesForTenant]', err);
    return {
      batches: [],
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
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
      .order('id', { ascending: false })
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

const SOURCE_FIELDS_SCAN_LIMIT = 5000;

/**
 * Distinct source_fields keys present on this tenant's jobs (for field filter dropdown).
 */
export async function getSourceFieldKeysForTenant(
  tenantId: string
): Promise<{ keys: string[]; error: Error | null }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('jobs')
      .select('source_fields')
      .eq('tenant_id', tenantId)
      .limit(SOURCE_FIELDS_SCAN_LIMIT);

    if (error) {
      console.error('[getSourceFieldKeysForTenant]', error);
      return { keys: [], error: toError(error) };
    }

    const keys = new Set<string>();
    for (const row of data ?? []) {
      const fields = parseSourceFields((row as { source_fields?: unknown }).source_fields);
      for (const key of Object.keys(fields)) keys.add(key);
    }
    return {
      keys: [...keys].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
      error: null,
    };
  } catch (err) {
    console.error('[getSourceFieldKeysForTenant]', err);
    return { keys: [], error: toError(err) };
  }
}

/**
 * Distinct values for a Phase 6 field filter (system or source_fields key).
 */
export async function getFieldFilterValuesForTenant(
  tenantId: string,
  field: string
): Promise<{ values: FieldFilterValueOption[]; error: Error | null }> {
  try {
    if (!field.trim()) return { values: [], error: null };

    if (isSourceFieldFilter(field)) {
      const key = decodeSourceFieldFilter(field);
      if (!key) return { values: [], error: null };
      const supabase = await createClient();
      const { data, error } = await supabase
        .from('jobs')
        .select('source_fields')
        .eq('tenant_id', tenantId)
        .limit(SOURCE_FIELDS_SCAN_LIMIT);
      if (error) {
        console.error('[getFieldFilterValuesForTenant] source', error);
        return { values: [], error: toError(error) };
      }
      const values = new Set<string>();
      for (const row of data ?? []) {
        const fields = parseSourceFields((row as { source_fields?: unknown }).source_fields);
        const v = fields[key]?.trim();
        if (v) values.add(v);
      }
      return {
        values: [...values]
          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
          .map((v) => ({ value: v, label: v })),
        error: null,
      };
    }

    switch (field as SystemFilterFieldKey) {
      case 'status': {
        const statuses: JobStatus[] = [
          'pending',
          'pending_send',
          'assigned',
          'in_progress',
          'paused',
          'completed',
          'declined',
          'cancelled',
        ];
        return {
          values: statuses.map((s) => ({
            value: s,
            label: JOB_STATUS_DISPLAY[s]?.label ?? s,
          })),
          error: null,
        };
      }
      case 'priority': {
        const priorities: JobPriority[] = ['low', 'normal', 'high', 'emergency'];
        return {
          values: priorities.map((p) => ({
            value: p,
            label: p.charAt(0).toUpperCase() + p.slice(1),
          })),
          error: null,
        };
      }
      case 'customer_id': {
        const { customers, error } = await getCustomerJobCounts(tenantId);
        if (error) return { values: [], error };
        return {
          values: customers.map((c) => ({
            value: c.customer_id ?? 'none',
            label: `${c.name} (${c.count})`,
          })),
          error: null,
        };
      }
      case 'assigned_worker_id': {
        const supabase = await createClient();
        const { data, error } = await supabase
          .from('jobs')
          .select('assigned_worker_id, worker:workers!assigned_worker_id(id, full_name)')
          .eq('tenant_id', tenantId)
          .limit(SOURCE_FIELDS_SCAN_LIMIT);
        if (error) {
          console.error('[getFieldFilterValuesForTenant] workers', error);
          return { values: [], error: toError(error) };
        }
        const byId = new Map<string, string>();
        let unassigned = 0;
        for (const row of data ?? []) {
          const r = row as {
            assigned_worker_id?: string | null;
            worker?: { full_name?: string } | null;
          };
          if (!r.assigned_worker_id) {
            unassigned += 1;
            continue;
          }
          if (!byId.has(r.assigned_worker_id)) {
            byId.set(r.assigned_worker_id, r.worker?.full_name?.trim() || 'Worker');
          }
        }
        const values: FieldFilterValueOption[] = [...byId.entries()]
          .map(([id, name]) => ({ value: id, label: name }))
          .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
        if (unassigned > 0) {
          values.unshift({ value: 'none', label: `Unassigned (${unassigned})` });
        }
        return { values, error: null };
      }
      case 'postcode': {
        const supabase = await createClient();
        const { data, error } = await supabase
          .from('jobs')
          .select('postcode')
          .eq('tenant_id', tenantId)
          .not('postcode', 'is', null)
          .limit(SOURCE_FIELDS_SCAN_LIMIT);
        if (error) {
          console.error('[getFieldFilterValuesForTenant] postcode', error);
          return { values: [], error: toError(error) };
        }
        const values = new Set<string>();
        for (const row of data ?? []) {
          const pc = String((row as { postcode?: string | null }).postcode ?? '').trim();
          if (pc) values.add(pc);
        }
        return {
          values: [...values]
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
            .map((v) => ({ value: v, label: v })),
          error: null,
        };
      }
      default:
        return { values: [], error: null };
    }
  } catch (err) {
    console.error('[getFieldFilterValuesForTenant]', err);
    return { values: [], error: toError(err) };
  }
}
