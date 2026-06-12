import { createClient } from '@/lib/supabase/server';

export interface ImportSourceRow {
  id: string;
  source_name: string;
  column_mapping: Record<string, string | null>;
  value_transforms: Record<string, Record<string, string>>;
  mapped_by: string;
  last_used_at: string | null;
  times_used: number;
  customer_id: string | null;
}

/**
 * Fetches import sources for the given tenant (for dropdown in import wizard).
 */
export async function getImportSourcesForTenant(
  tenantId: string
): Promise<{ sources: ImportSourceRow[]; error: Error | null }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('import_sources')
      .select(
        'id, source_name, column_mapping, value_transforms, mapped_by, last_used_at, times_used, customer_id'
      )
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('last_used_at', { ascending: false });

    if (error) {
      console.error('[getImportSourcesForTenant]', error);
      return { sources: [], error: new Error(error.message ?? 'Failed to load import sources') };
    }

    const sources: ImportSourceRow[] = (Array.isArray(data) ? data : []).map(
      (row: {
        id: string;
        source_name: string;
        column_mapping: unknown;
        value_transforms: unknown;
        mapped_by: string;
        last_used_at: string | null;
        times_used: number;
        customer_id: string | null;
      }) => ({
        id: row.id,
        source_name: row.source_name ?? '',
        column_mapping: (row.column_mapping as Record<string, string | null>) ?? {},
        value_transforms:
          (row.value_transforms as Record<string, Record<string, string>>) ?? {},
        mapped_by: row.mapped_by ?? 'manual',
        last_used_at: row.last_used_at ?? null,
        times_used: row.times_used ?? 0,
        customer_id: row.customer_id ?? null,
      })
    );
    return { sources, error: null };
  } catch (err) {
    console.error('[getImportSourcesForTenant]', err);
    return {
      sources: [],
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}
