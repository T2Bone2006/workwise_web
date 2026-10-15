'use server';

import { revalidatePath } from 'next/cache';
import { getOwnerTenantId } from '@/lib/auth/require-owner';
import { getTenantProducts } from '@/lib/data/tenant-products';
import type { TenantSettings } from '@/lib/data/settings-types';
import { createClient } from '@/lib/supabase/server';
import {
  normaliseJobReportFields,
  serialiseJobReportFields,
  type JobReportField,
  type JobReportFieldInput,
} from '@/lib/jobs/job-report-fields';

export type SaveJobReportFieldsResult =
  | { success: true; fields: JobReportField[] }
  | { success: false; error: string };

/**
 * Replaces this business's finish-job questions. Other settings are left as
 * they are. Owner of a Pro business only.
 */
export async function saveJobReportFields(
  input: JobReportFieldInput[]
): Promise<SaveJobReportFieldsResult> {
  const tenantId = await getOwnerTenantId();
  if (!tenantId) {
    return { success: false, error: 'Only the account owner can change these questions.' };
  }
  if (!(await getTenantProducts()).isPro) {
    return { success: false, error: 'Completion questions are part of Pro.' };
  }

  const checked = normaliseJobReportFields(input);
  if (!checked.ok) return { success: false, error: checked.error };

  const supabase = await createClient();
  const { data: tenant, error: readError } = await supabase
    .from('tenants')
    .select('settings')
    .eq('id', tenantId)
    .maybeSingle();
  if (readError) {
    console.error('[saveJobReportFields] read', readError);
    return { success: false, error: 'Could not save. Please try again.' };
  }

  const current: TenantSettings = (tenant?.settings as TenantSettings) ?? {};
  const next: TenantSettings = {
    ...current,
    job_report_fields: serialiseJobReportFields(checked.fields),
  };

  const { error } = await supabase.from('tenants').update({ settings: next }).eq('id', tenantId);
  if (error) {
    console.error('[saveJobReportFields] write', error);
    return { success: false, error: 'Could not save. Please try again.' };
  }

  revalidatePath('/settings');
  revalidatePath('/jobs');
  return { success: true, fields: checked.fields };
}
