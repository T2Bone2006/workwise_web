'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { getOwnerTenantId } from '@/lib/auth/require-owner';
import { createClient } from '@/lib/supabase/server';
import {
  getFieldGroupsForTenant,
  getHeaderCountsForTenant,
  type HeaderCount,
} from '@/lib/data/field-groups';
import { getSourceFieldKeysForTenant } from '@/lib/data/jobs';
import { type TenantSettings } from '@/lib/data/settings-types';
import {
  normaliseFieldGroups,
  parseFieldGroups,
  ungroupedHeaders,
  type FieldGroup,
} from '@/lib/jobs/field-groups';

export type SaveFieldGroupsResult =
  | { success: true; groups: FieldGroup[] }
  | { success: false; error: string };

/**
 * Saves the business's whole list of named fields. Same read-merge-write on
 * `tenants.settings` that every other Settings save uses, so nothing else in
 * settings is disturbed. Owner only.
 */
export async function saveFieldGroups(
  input: Array<{ id?: string | null; name: string; aliases: string[] }>
): Promise<SaveFieldGroupsResult> {
  const tenantId = await getOwnerTenantId();
  if (!tenantId) return { success: false, error: 'Only the account owner can change fields.' };

  const checked = normaliseFieldGroups(input, () => `fg_${randomUUID().slice(0, 8)}`);
  if (!checked.ok) return { success: false, error: checked.error };

  const supabase = await createClient();
  const { data: tenant, error: readError } = await supabase
    .from('tenants')
    .select('settings')
    .eq('id', tenantId)
    .maybeSingle();
  if (readError) {
    console.error('[saveFieldGroups] read', readError);
    return { success: false, error: 'Could not save. Please try again.' };
  }

  const current: TenantSettings = (tenant?.settings as TenantSettings) ?? {};
  const keep = new Set(checked.groups.map((g) => encodeColumnId(g.id)));
  // A column showing a field that has just been deleted would only be dead weight.
  const columns = (current.jobs_list?.columns ?? []).filter(
    (c) => !c.startsWith('fg:') || keep.has(c)
  );
  const next: TenantSettings = {
    ...current,
    field_groups: checked.groups,
    ...(current.jobs_list ? { jobs_list: { ...current.jobs_list, columns } } : {}),
  };

  const { error } = await supabase.from('tenants').update({ settings: next }).eq('id', tenantId);
  if (error) {
    console.error('[saveFieldGroups] write', error);
    return { success: false, error: 'Could not save. Please try again.' };
  }

  revalidatePath('/jobs');
  revalidatePath('/settings');
  return { success: true, groups: parseFieldGroups(checked.groups) };
}

function encodeColumnId(groupId: string): string {
  return `fg:${groupId}`;
}

/**
 * Spreadsheet columns that exist on this business's jobs but aren't in any
 * field yet. Fetched on demand when a filter or column list is opened — it
 * reads the jobs' stored columns, so the jobs page itself never waits for it.
 */
export async function fetchUngroupedHeadersAction(): Promise<string[]> {
  const tenantId = await getOwnerTenantId();
  if (!tenantId) return [];
  const [{ keys }, groups] = await Promise.all([
    getSourceFieldKeysForTenant(tenantId),
    getFieldGroupsForTenant(tenantId),
  ]);
  return ungroupedHeaders(keys, groups);
}

/** Settings screen: every spreadsheet column on the business's jobs, with job counts. */
export async function fetchHeaderCountsAction(): Promise<{
  headers: HeaderCount[];
  truncated: boolean;
}> {
  const tenantId = await getOwnerTenantId();
  if (!tenantId) return { headers: [], truncated: false };
  return getHeaderCountsForTenant(tenantId);
}
