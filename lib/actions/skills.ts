'use server';

import { createClient } from '@/lib/supabase/server';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';

export type TenantSkillRow = {
  id: string;
  key: string;
  label: string;
};

const LOWER_SNAKE_CASE_KEY = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

function isLowerSnakeCaseKey(key: string): boolean {
  return LOWER_SNAKE_CASE_KEY.test(key);
}

/**
 * Loads custom skills configured for the given tenant.
 * Returns [] if the caller is not authenticated or `tenantId` is not their tenant.
 */
export async function getTenantSkills(tenantId: string): Promise<TenantSkillRow[]> {
  const currentTenantId = await getTenantIdForCurrentUser();
  if (!currentTenantId || currentTenantId !== tenantId.trim()) {
    return [];
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('tenant_skills')
    .select('id, key, label')
    .eq('tenant_id', tenantId)
    .order('key');

  if (error) {
    console.error('[getTenantSkills]', error);
    return [];
  }

  return (data ?? []) as TenantSkillRow[];
}

export type MutateTenantSkillResult =
  | { success: true }
  | { success: false; error: string };

export async function addTenantSkill(key: string, label: string): Promise<MutateTenantSkillResult> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) {
    return { success: false, error: 'Not authenticated.' };
  }

  const trimmedKey = key.trim();
  const trimmedLabel = label.trim();
  if (!trimmedKey) {
    return { success: false, error: 'Skill key is required.' };
  }
  if (!trimmedLabel) {
    return { success: false, error: 'Label is required.' };
  }
  if (!isLowerSnakeCaseKey(trimmedKey)) {
    return {
      success: false,
      error: 'Skill key must be lowercase snake_case (e.g. residential_locks).',
    };
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('tenant_skills')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('key', trimmedKey)
    .maybeSingle();

  if (existing) {
    return { success: false, error: 'A skill with this key already exists.' };
  }

  const { error } = await supabase.from('tenant_skills').insert({
    tenant_id: tenantId,
    key: trimmedKey,
    label: trimmedLabel,
  });

  if (error) {
    console.error('[addTenantSkill]', error);
    if (error.code === '23505') {
      return { success: false, error: 'A skill with this key already exists.' };
    }
    return { success: false, error: error.message ?? 'Failed to add skill.' };
  }

  return { success: true };
}

export async function updateTenantSkill(
  id: string,
  label: string
): Promise<MutateTenantSkillResult> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) {
    return { success: false, error: 'Not authenticated.' };
  }

  const trimmedId = id.trim();
  const trimmedLabel = label.trim();
  if (!trimmedId) {
    return { success: false, error: 'Skill id is required.' };
  }
  if (!trimmedLabel) {
    return { success: false, error: 'Label is required.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('tenant_skills')
    .update({ label: trimmedLabel })
    .eq('id', trimmedId)
    .eq('tenant_id', tenantId)
    .select('id');

  if (error) {
    console.error('[updateTenantSkill]', error);
    return { success: false, error: error.message ?? 'Failed to update skill.' };
  }

  if (!data?.length) {
    return { success: false, error: 'Skill not found.' };
  }

  return { success: true };
}

export async function deleteTenantSkill(id: string): Promise<MutateTenantSkillResult> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) {
    return { success: false, error: 'Not authenticated.' };
  }

  const trimmedId = id.trim();
  if (!trimmedId) {
    return { success: false, error: 'Skill id is required.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('tenant_skills')
    .delete()
    .eq('id', trimmedId)
    .eq('tenant_id', tenantId)
    .select('id');

  if (error) {
    console.error('[deleteTenantSkill]', error);
    return { success: false, error: error.message ?? 'Failed to delete skill.' };
  }

  if (!data?.length) {
    return { success: false, error: 'Skill not found.' };
  }

  return { success: true };
}
