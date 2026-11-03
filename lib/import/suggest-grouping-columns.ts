'use server';

import { createClient } from '@/lib/supabase/server';
import { resolveGroupingColumns } from '@/lib/import/job-grouping';

export type GroupingSuggestion = {
  columns: string[];
  /** Where the columns came from — drives the wizard copy. */
  source: 'saved' | 'none';
  reason: string | null;
};

export type SuggestGroupingResult =
  | { success: true; suggestion: GroupingSuggestion }
  | { success: false; error: string };

/**
 * Columns this customer grouped by last time. Nothing is invented: if they
 * have never chosen, the list is empty and the wizard waits for them to tick.
 * [] is a real saved choice (grouping left off). Nothing is written here —
 * importJobs stores whatever is ticked when they import.
 */
export async function suggestGroupingColumns(params: {
  customerId: string;
  headers: string[];
  rows: Record<string, string>[];
}): Promise<SuggestGroupingResult> {
  const headers = params.headers.filter((h) => h.trim() !== '');
  if (headers.length === 0 || params.rows.length < 2) {
    return { success: true, suggestion: { columns: [], source: 'none', reason: null } };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return { success: false, error: 'Not authenticated' };

  const { data: userRow } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single();
  const tenantId = userRow?.tenant_id;
  if (!tenantId) return { success: false, error: 'No tenant assigned.' };

  const { data: source } = await supabase
    .from('import_sources')
    .select('id, grouping_columns')
    .eq('tenant_id', tenantId)
    .eq('customer_id', params.customerId)
    .eq('is_active', true)
    .order('last_used_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (source && Array.isArray(source.grouping_columns)) {
    const saved = (source.grouping_columns as unknown[]).filter(
      (c): c is string => typeof c === 'string'
    );
    return {
      success: true,
      suggestion: {
        columns: resolveGroupingColumns(saved, headers),
        source: 'saved',
        reason: null,
      },
    };
  }

  return { success: true, suggestion: { columns: [], source: 'none', reason: null } };
}
