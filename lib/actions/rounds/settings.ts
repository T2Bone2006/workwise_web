'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { parseRoundsSettings, withRoundsSettings } from '@/lib/rounds/settings';
import {
  roundsSettingsSchema,
  type RoundsSettingsInput,
} from '@/lib/validations/rounds/settings';

export type ActionResult = { success: true } | { success: false; error: string };

function firstZodError(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid input';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function updateRoundsSettings(
  input: RoundsSettingsInput,
): Promise<ActionResult> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'Not authenticated' };

  const parsed = roundsSettingsSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const rounds = parseRoundsSettings(parsed.data);

  const supabase = await createClient();
  const { data: tenant, error: loadError } = await supabase
    .from('tenants')
    .select('settings')
    .eq('id', tenantId)
    .maybeSingle();

  if (loadError) {
    console.error('[updateRoundsSettings] load', loadError);
    return { success: false, error: loadError.message };
  }

  const current = isPlainObject(tenant?.settings) ? tenant.settings : {};
  const settings = withRoundsSettings(current, rounds);

  const { error } = await supabase
    .from('tenants')
    .update({ settings })
    .eq('id', tenantId);

  if (error) {
    console.error('[updateRoundsSettings]', error);
    return { success: false, error: error.message };
  }

  revalidatePath('/settings');
  revalidatePath('/rounds/calendar');
  return { success: true };
}
