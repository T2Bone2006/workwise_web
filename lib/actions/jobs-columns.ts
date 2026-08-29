'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import {
  isJobsListColumnKey,
  type JobsListColumnKey,
  type TenantSettings,
} from '@/lib/data/settings-types';

/**
 * Saves which standard fields show as jobs-list columns. Per-account, same
 * `tenants.settings` jsonb the rest of Settings uses — see lib/actions/settings.ts
 * for the established read-merge-write pattern this follows.
 */
export async function updateJobsListColumns(
  columns: string[]
): Promise<{ success: boolean; error?: string }> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'No tenant found' };

  const validColumns: JobsListColumnKey[] = columns.filter(isJobsListColumnKey);

  const supabase = await createClient();
  const { data: tenant } = await supabase
    .from('tenants')
    .select('settings')
    .eq('id', tenantId)
    .maybeSingle();

  const currentSettings: TenantSettings = (tenant?.settings as TenantSettings) ?? {};
  const newSettings: TenantSettings = {
    ...currentSettings,
    jobs_list: { ...currentSettings.jobs_list, columns: validColumns },
  };

  const { error } = await supabase
    .from('tenants')
    .update({ settings: newSettings })
    .eq('id', tenantId);

  if (error) {
    console.error('[updateJobsListColumns]', error);
    return { success: false, error: error.message };
  }
  revalidatePath('/jobs');
  return { success: true };
}
