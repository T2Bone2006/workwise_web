'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import {
  assignWorkerToJobIds,
  type BulkAssignJobsResult,
} from '@/lib/jobs/assign-worker-to-jobs';

export type JobGroupActionResult =
  | { success: true; groupId: string; count: number }
  | { success: false; error: string };

export type UngroupJobsResult =
  | { success: true; count: number }
  | { success: false; error: string };

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Delete any of the given groups that no longer have members. Groups are
 * only meaningful as a set, so an emptied one is noise rather than history.
 */
async function pruneEmptyGroups(
  supabase: ServerSupabase,
  tenantId: string,
  groupIds: string[]
): Promise<void> {
  const ids = [...new Set(groupIds)].filter(Boolean);
  if (!ids.length) return;

  const { data: stillUsed, error } = await supabase
    .from('jobs')
    .select('job_group_id')
    .eq('tenant_id', tenantId)
    .in('job_group_id', ids);
  if (error) {
    console.error('[pruneEmptyGroups] lookup', error);
    return;
  }
  const used = new Set((stillUsed ?? []).map((r) => r.job_group_id as string));
  const empty = ids.filter((id) => !used.has(id));
  if (!empty.length) return;

  const { error: delError } = await supabase
    .from('job_groups')
    .delete()
    .eq('tenant_id', tenantId)
    .in('id', empty);
  if (delError) console.error('[pruneEmptyGroups] delete', delError);
}

/**
 * Put the given jobs into one new group. Jobs already in another group are
 * moved (their old group is pruned if left empty) — regrouping should never
 * need an ungroup step first.
 */
export async function createJobGroup(
  jobIds: string[],
  label: string
): Promise<JobGroupActionResult> {
  try {
    const uniqueIds = [...new Set(jobIds)];
    if (uniqueIds.length < 2) {
      return { success: false, error: 'Select at least two jobs to group.' };
    }
    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      return { success: false, error: 'Give the group a name.' };
    }

    const tenantId = await getTenantIdForCurrentUser();
    if (!tenantId) {
      return { success: false, error: 'No tenant assigned.' };
    }

    const supabase = await createClient();
    const { data: rows, error: fetchError } = await supabase
      .from('jobs')
      .select('id, job_group_id')
      .eq('tenant_id', tenantId)
      .in('id', uniqueIds);

    if (fetchError) {
      return { success: false, error: fetchError.message };
    }
    if (!rows || rows.length !== uniqueIds.length) {
      return { success: false, error: 'Some selected jobs were not found or access denied.' };
    }

    const { data: group, error: insertError } = await supabase
      .from('job_groups')
      .insert({ tenant_id: tenantId, label: trimmedLabel })
      .select('id')
      .single();

    if (insertError || !group) {
      console.error('[createJobGroup] insert', insertError);
      return { success: false, error: insertError?.message ?? 'Failed to create group.' };
    }

    const { error: updateError } = await supabase
      .from('jobs')
      .update({ job_group_id: group.id, updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .in('id', uniqueIds);

    if (updateError) {
      console.error('[createJobGroup] update jobs', updateError);
      // Don't leave an orphan group behind.
      await supabase.from('job_groups').delete().eq('id', group.id).eq('tenant_id', tenantId);
      return { success: false, error: updateError.message ?? 'Failed to group jobs.' };
    }

    await pruneEmptyGroups(
      supabase,
      tenantId,
      rows.map((r) => r.job_group_id as string | null).filter((id): id is string => !!id)
    );

    revalidatePath('/jobs');
    for (const id of uniqueIds) revalidatePath(`/jobs/${id}`);
    return { success: true, groupId: group.id as string, count: uniqueIds.length };
  } catch (err) {
    console.error('[createJobGroup]', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unable to group jobs.',
    };
  }
}

/** Remove the given jobs from whatever group they are in; empty groups are deleted. */
export async function ungroupJobs(jobIds: string[]): Promise<UngroupJobsResult> {
  try {
    const uniqueIds = [...new Set(jobIds)];
    if (!uniqueIds.length) {
      return { success: false, error: 'No jobs selected.' };
    }

    const tenantId = await getTenantIdForCurrentUser();
    if (!tenantId) {
      return { success: false, error: 'No tenant assigned.' };
    }

    const supabase = await createClient();
    const { data: rows, error: fetchError } = await supabase
      .from('jobs')
      .select('id, job_group_id')
      .eq('tenant_id', tenantId)
      .in('id', uniqueIds)
      .not('job_group_id', 'is', null);

    if (fetchError) {
      return { success: false, error: fetchError.message };
    }
    if (!rows?.length) {
      return { success: true, count: 0 };
    }

    const ids = rows.map((r) => r.id as string);
    const { error: updateError } = await supabase
      .from('jobs')
      .update({ job_group_id: null, updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .in('id', ids);

    if (updateError) {
      console.error('[ungroupJobs] update', updateError);
      return { success: false, error: updateError.message ?? 'Failed to ungroup jobs.' };
    }

    await pruneEmptyGroups(
      supabase,
      tenantId,
      rows.map((r) => r.job_group_id as string)
    );

    revalidatePath('/jobs');
    for (const id of ids) revalidatePath(`/jobs/${id}`);
    return { success: true, count: ids.length };
  } catch (err) {
    console.error('[ungroupJobs]', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unable to ungroup jobs.',
    };
  }
}

/** Dissolve a whole group: every member is ungrouped and the group row removed. */
export async function deleteJobGroup(groupId: string): Promise<UngroupJobsResult> {
  try {
    const tenantId = await getTenantIdForCurrentUser();
    if (!tenantId) {
      return { success: false, error: 'No tenant assigned.' };
    }

    const supabase = await createClient();
    const { data: members, error: fetchError } = await supabase
      .from('jobs')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('job_group_id', groupId);
    if (fetchError) {
      return { success: false, error: fetchError.message };
    }

    const ids = (members ?? []).map((r) => r.id as string);
    if (ids.length) {
      const { error: updateError } = await supabase
        .from('jobs')
        .update({ job_group_id: null, updated_at: new Date().toISOString() })
        .eq('tenant_id', tenantId)
        .in('id', ids);
      if (updateError) {
        return { success: false, error: updateError.message ?? 'Failed to ungroup jobs.' };
      }
    }

    const { error: delError } = await supabase
      .from('job_groups')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', groupId);
    if (delError) {
      return { success: false, error: delError.message ?? 'Failed to delete group.' };
    }

    revalidatePath('/jobs');
    for (const id of ids) revalidatePath(`/jobs/${id}`);
    return { success: true, count: ids.length };
  } catch (err) {
    console.error('[deleteJobGroup]', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unable to delete group.',
    };
  }
}

/**
 * Assign one worker to every job in the group — all members, not just the
 * ones on the current page of the list.
 */
export async function assignJobGroup(
  groupId: string,
  workerId: string
): Promise<BulkAssignJobsResult> {
  try {
    const tenantId = await getTenantIdForCurrentUser();
    if (!tenantId) {
      return { success: false, error: 'No tenant assigned.' };
    }

    const supabase = await createClient();
    const { data: members, error: fetchError } = await supabase
      .from('jobs')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('job_group_id', groupId);
    if (fetchError) {
      return { success: false, error: fetchError.message };
    }
    const ids = (members ?? []).map((r) => r.id as string);
    if (!ids.length) {
      return { success: false, error: 'Group has no jobs.' };
    }

    return await assignWorkerToJobIds(supabase, tenantId, ids, workerId);
  } catch (err) {
    console.error('[assignJobGroup]', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unable to assign worker. Please try again.',
    };
  }
}
