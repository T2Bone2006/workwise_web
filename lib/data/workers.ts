import { createClient } from '@/lib/supabase/server';

export interface WorkerRow {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  status: string | null;
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
      .select('id, full_name, phone, email, status')
      .eq('primary_tenant_id', tenantId)
      .eq('status', 'available')
      .order('full_name');

    if (error) {
      console.error('[getWorkersForTenant] workers', error);
      return { workers: [], error: new Error(error.message ?? 'Failed to load workers') };
    }

    const workers: WorkerRow[] = (Array.isArray(data) ? data : []).map(
      (row: { id: string; full_name: string; phone?: string | null; email?: string | null; status?: string | null }) => ({
        id: row.id,
        full_name: row.full_name ?? '',
        phone: row.phone ?? null,
        email: row.email ?? null,
        status: row.status ?? null,
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
