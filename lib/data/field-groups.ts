import { createClient } from '@/lib/supabase/server';
import { parseSourceFields } from '@/lib/jobs/job-search-matches';
import { parseFieldGroups, type FieldGroup } from '@/lib/jobs/field-groups';

/**
 * The business's named fields. They live in `tenants.settings.field_groups`
 * (jsonb), the same place the rest of Settings keeps its values, so there is
 * no table of their own. Never throws: no groups is a safe answer.
 */
export async function getFieldGroupsForTenant(tenantId: string): Promise<FieldGroup[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('tenants')
      .select('settings')
      .eq('id', tenantId)
      .maybeSingle();
    if (error) {
      console.error('[getFieldGroupsForTenant]', error);
      return [];
    }
    return parseFieldGroups((data?.settings as { field_groups?: unknown } | null)?.field_groups);
  } catch (err) {
    console.error('[getFieldGroupsForTenant]', err);
    return [];
  }
}

export interface HeaderCount {
  header: string;
  /** Jobs that carry this spreadsheet column. */
  jobs: number;
}

const HEADER_SCAN_LIMIT = 5000;

/**
 * Every spreadsheet column found on this business's jobs, with how many jobs
 * carry it. Reads the most recent jobs only (a business with more than
 * HEADER_SCAN_LIMIT jobs gets `truncated`), because the columns live inside
 * each job's own `source_fields`.
 */
export async function getHeaderCountsForTenant(
  tenantId: string
): Promise<{ headers: HeaderCount[]; truncated: boolean }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('jobs')
      .select('source_fields')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(HEADER_SCAN_LIMIT);
    if (error) {
      console.error('[getHeaderCountsForTenant]', error);
      return { headers: [], truncated: false };
    }
    const counts = new Map<string, number>();
    for (const row of data ?? []) {
      for (const key of Object.keys(parseSourceFields((row as { source_fields?: unknown }).source_fields))) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    const headers = [...counts.entries()]
      .map(([header, jobs]) => ({ header, jobs }))
      .sort((a, b) => a.header.localeCompare(b.header, undefined, { sensitivity: 'base' }));
    return { headers, truncated: (data?.length ?? 0) >= HEADER_SCAN_LIMIT };
  } catch (err) {
    console.error('[getHeaderCountsForTenant]', err);
    return { headers: [], truncated: false };
  }
}
