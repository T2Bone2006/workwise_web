import { createClient } from '@/lib/supabase/server';
import type { JobStatus } from '@/lib/data/jobs';

export interface NetworkConnectionRow {
  id: string;
  tenant_id_a: string;
  tenant_id_b: string;
  invited_by_tenant_id: string | null;
  invite_email: string | null;
  message: string | null;
  status: string | null;
  created_at: string | null;
  trade_types: string[];
  coverage_radius_miles: number | null;
  other_tenant_id: string | null;
  other_tenant_name: string | null;
  other_tenant_slug: string | null;
}

export interface NetworkDispatchedJobRow {
  id: string;
  canonical_job_id: string | null;
  originating_reference_number: string | null;
  receiving_tenant_id: string | null;
  receiving_tenant_name: string | null;
  other_tenant_name: string | null;
  status: string | null;
  reference_number: string | null;
  scheduled_date: string | null;
  assigned_worker_id: string | null;
  assigned_worker_name: string | null;
  created_at: string | null;
  originating_customer_snapshot: Record<string, unknown> | null;
  address: string | null;
}

export interface DispatchedJobsFilters {
  search?: string;
  receiving_tenant_id?: string;
  status?: JobStatus;
  import_source_id?: string;
  page?: number;
}

const PAGE_SIZE = 50;

export interface NetworkInboxRow {
  id: string;
  connection_id: string | null;
  canonical_job_id: string | null;
  originating_tenant_id: string | null;
  originating_tenant_name: string | null;
  originating_reference_number: string | null;
  originating_customer_snapshot: Record<string, unknown> | null;
  created_at: string | null;
}

function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return new Error((err as { message: string }).message);
  }
  return new Error(String(err));
}

export async function getConnectionsForTenant(
  tenantId: string
): Promise<{ connections: NetworkConnectionRow[]; error: Error | null }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('tenant_network_connections')
      .select(
        `
        id,
        tenant_id_a,
        tenant_id_b,
        invited_by_tenant_id,
        invite_email,
        message,
        status,
        created_at,
        trade_types,
        coverage_radius_miles,
        tenant_a:tenants!tenant_network_connections_tenant_id_a_fkey(id, name, slug),
        tenant_b:tenants!tenant_network_connections_tenant_id_b_fkey(id, name, slug)
      `
      )
      .or(`tenant_id_a.eq.${tenantId},tenant_id_b.eq.${tenantId}`)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[getConnectionsForTenant]', error);
      return { connections: [], error: toError(error) };
    }

    const connections: NetworkConnectionRow[] = (Array.isArray(data) ? data : []).map((row: Record<string, unknown>) => {
      const tenantA = row.tenant_a as { id?: string; name?: string; slug?: string } | null;
      const tenantB = row.tenant_b as { id?: string; name?: string; slug?: string } | null;
      const isTenantA = (row.tenant_id_a as string | null) === tenantId;
      const otherTenant = isTenantA ? tenantB : tenantA;
      return {
        id: row.id as string,
        tenant_id_a: row.tenant_id_a as string,
        tenant_id_b: row.tenant_id_b as string,
        invited_by_tenant_id: (row.invited_by_tenant_id as string | null) ?? null,
        invite_email: (row.invite_email as string | null) ?? null,
        message: (row.message as string | null) ?? null,
        status: (row.status as string | null) ?? null,
        created_at: (row.created_at as string | null) ?? null,
        trade_types: Array.isArray(row.trade_types) ? (row.trade_types as string[]) : [],
        coverage_radius_miles:
          row.coverage_radius_miles == null ? null : Number(row.coverage_radius_miles),
        other_tenant_id: otherTenant?.id ?? null,
        other_tenant_name: otherTenant?.name ?? null,
        other_tenant_slug: otherTenant?.slug ?? null,
      };
    });

    return { connections, error: null };
  } catch (err) {
    console.error('[getConnectionsForTenant]', err);
    return { connections: [], error: toError(err) };
  }
}

export async function getDispatchedJobs(
  tenantId: string,
  filters: DispatchedJobsFilters = {}
): Promise<{ dispatches: NetworkDispatchedJobRow[]; totalCount: number; error: Error | null }> {
  try {
    const supabase = await createClient();
    const page = Math.max(1, filters.page ?? 1);
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from('network_job_dispatches')
      .select(
        `
        id,
        canonical_job_id,
        originating_reference_number,
        originating_customer_snapshot,
        receiving_tenant_id,
        created_at,
        receiving_tenant:tenants!network_job_dispatches_receiving_tenant_id_fkey(name),
        canonical_job:jobs!network_job_dispatches_canonical_job_id_fkey(
          status,
          reference_number,
          scheduled_date,
          import_source_id,
          assigned_worker_id,
          assigned_worker:workers!jobs_assigned_worker_id_fkey(full_name)
        )
      `,
        { count: 'exact' }
      )
      .eq('originating_tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (filters.receiving_tenant_id) {
      query = query.eq('receiving_tenant_id', filters.receiving_tenant_id);
    }
    if (filters.status) {
      query = query.eq('canonical_job.status', filters.status);
    }
    if (filters.import_source_id) {
      if (filters.import_source_id === 'ungrouped') {
        query = query.is('canonical_job.import_source_id', null);
      } else {
        query = query.eq('canonical_job.import_source_id', filters.import_source_id);
      }
    }
    if (filters.search?.trim()) {
      const term = filters.search.trim();
      query = query.or(
        `originating_reference_number.ilike.%${term}%,originating_customer_snapshot->>address.ilike.%${term}%`
      );
    }

    const { data: filteredData, error: filteredError, count } = await query;

    if (filteredError) {
      console.error('[getDispatchedJobs]', filteredError);
      return { dispatches: [], totalCount: 0, error: toError(filteredError) };
    }

    const dispatches: NetworkDispatchedJobRow[] = (Array.isArray(filteredData) ? filteredData : []).map((row: Record<string, unknown>) => {
      const canonicalJob = row.canonical_job as {
        status?: string;
        reference_number?: string;
        scheduled_date?: string;
        import_source_id?: string | null;
        assigned_worker_id?: string;
        assigned_worker?: { full_name?: string } | null;
      } | null;
      const receivingTenant = row.receiving_tenant as { name?: string } | null;
      const snapshot = (row.originating_customer_snapshot as Record<string, unknown> | null) ?? null;
      const snapshotAddress = snapshot && typeof snapshot.address === 'string' ? snapshot.address : null;
      const workerName = canonicalJob?.assigned_worker?.full_name?.split(' ')[0] ?? null;

      return {
        id: row.id as string,
        canonical_job_id: (row.canonical_job_id as string | null) ?? null,
        originating_reference_number: (row.originating_reference_number as string | null) ?? null,
        receiving_tenant_id: (row.receiving_tenant_id as string | null) ?? null,
        receiving_tenant_name: receivingTenant?.name ?? null,
        other_tenant_name: receivingTenant?.name ?? null,
        status: canonicalJob?.status ?? null,
        reference_number: canonicalJob?.reference_number ?? null,
        scheduled_date: canonicalJob?.scheduled_date ?? null,
        assigned_worker_id: canonicalJob?.assigned_worker_id ?? null,
        assigned_worker_name: workerName,
        created_at: (row.created_at as string | null) ?? null,
        originating_customer_snapshot: snapshot,
        address: snapshotAddress,
      };
    });

    return {
      dispatches,
      totalCount: typeof count === 'number' ? count : 0,
      error: null,
    };
  } catch (err) {
    console.error('[getDispatchedJobs]', err);
    return { dispatches: [], totalCount: 0, error: toError(err) };
  }
}

export async function getNetworkInbox(
  tenantId: string
): Promise<{ inbox: NetworkInboxRow[]; error: Error | null }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('jobs')
      .select(
        `
        id,
        network_dispatch_id,
        network_dispatch:network_job_dispatches!jobs_network_dispatch_id_fkey(
          id,
          connection_id,
          originating_tenant_id,
          originating_reference_number,
          originating_customer_snapshot,
          created_at,
          originating_tenant:tenants!network_job_dispatches_originating_tenant_id_fkey(name)
        )
      `
      )
      .eq('tenant_id', tenantId)
      .eq('status', 'pending_send')
      .not('network_dispatch_id', 'is', null)
      .order('created_at', { ascending: false, foreignTable: 'network_job_dispatches' });

    if (error) {
      console.error('[getNetworkInbox]', error);
      return { inbox: [], error: toError(error) };
    }

    const inbox: NetworkInboxRow[] = (Array.isArray(data) ? data : []).map((row: Record<string, unknown>) => {
      const dispatch = row.network_dispatch as {
        connection_id?: string | null;
        originating_tenant_id?: string | null;
        originating_reference_number?: string | null;
        originating_customer_snapshot?: Record<string, unknown> | null;
        created_at?: string | null;
        originating_tenant?: { name?: string } | null;
      } | null;
      const originatingTenant = dispatch?.originating_tenant ?? null;
      return {
        id: row.network_dispatch_id as string,
        connection_id: dispatch?.connection_id ?? null,
        canonical_job_id: row.id as string,
        originating_tenant_id: dispatch?.originating_tenant_id ?? null,
        originating_tenant_name: originatingTenant?.name ?? null,
        originating_reference_number: dispatch?.originating_reference_number ?? null,
        originating_customer_snapshot: dispatch?.originating_customer_snapshot ?? null,
        created_at: dispatch?.created_at ?? null,
      };
    });

    return { inbox, error: null };
  } catch (err) {
    console.error('[getNetworkInbox]', err);
    return { inbox: [], error: toError(err) };
  }
}
