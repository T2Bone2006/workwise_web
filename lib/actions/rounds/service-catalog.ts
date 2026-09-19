'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import {
  SERVICE_PRESETS,
  type ServicePreset,
} from '@/lib/rounds/service-catalog-presets';
import { serviceSchema, type ServiceInput } from '@/lib/validations/rounds/service';

export type ActionResult = { success: true } | { success: false; error: string };

const uuidSchema = z.string().uuid('Invalid service');

function firstZodError(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid input';
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

function revalidateCatalog() {
  revalidatePath('/rounds/services');
  revalidatePath('/rounds');
  revalidatePath('/dashboard');
}

async function nextSortOrder(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
): Promise<number> {
  const { data } = await supabase
    .from('service_catalog')
    .select('sort_order')
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const current = typeof data?.sort_order === 'number' ? data.sort_order : 0;
  return current + 1;
}

function toInsertRow(
  tenantId: string,
  values: z.output<typeof serviceSchema>,
  sortOrder: number,
) {
  return {
    tenant_id: tenantId,
    name: values.name,
    default_price: values.default_price,
    default_duration_minutes: values.default_duration_minutes,
    default_frequency_days: values.default_frequency_days ?? null,
    is_active: values.is_active,
    sort_order: sortOrder,
  };
}

export async function createService(
  input: ServiceInput,
): Promise<{ success: true; id: string } | { success: false; error: string }> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'Not authenticated' };

  const parsed = serviceSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const sortOrder = await nextSortOrder(supabase, tenantId);
  const { data, error } = await supabase
    .from('service_catalog')
    .insert(toInsertRow(tenantId, parsed.data, sortOrder))
    .select('id')
    .single();

  if (error) {
    console.error('[createService]', error);
    if (isUniqueViolation(error)) {
      return { success: false, error: 'A service with this name already exists.' };
    }
    return { success: false, error: error.message };
  }

  const id = typeof data?.id === 'string' ? data.id : null;
  if (!id) return { success: false, error: 'Failed to create service' };

  revalidateCatalog();
  return { success: true, id };
}

export async function updateService(
  id: string,
  input: ServiceInput,
): Promise<ActionResult> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'Not authenticated' };

  const idParsed = uuidSchema.safeParse(id);
  if (!idParsed.success) return { success: false, error: firstZodError(idParsed.error) };

  const parsed = serviceSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase
    .from('service_catalog')
    .update({
      name: parsed.data.name,
      default_price: parsed.data.default_price,
      default_duration_minutes: parsed.data.default_duration_minutes,
      default_frequency_days: parsed.data.default_frequency_days ?? null,
      is_active: parsed.data.is_active,
    })
    .eq('id', idParsed.data)
    .eq('tenant_id', tenantId);

  if (error) {
    console.error('[updateService]', error);
    if (isUniqueViolation(error)) {
      return { success: false, error: 'A service with this name already exists.' };
    }
    return { success: false, error: error.message };
  }

  revalidateCatalog();
  return { success: true };
}

export async function deactivateService(id: string): Promise<ActionResult> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'Not authenticated' };

  const idParsed = uuidSchema.safeParse(id);
  if (!idParsed.success) return { success: false, error: firstZodError(idParsed.error) };

  const supabase = await createClient();
  const { error } = await supabase
    .from('service_catalog')
    .update({ is_active: false })
    .eq('id', idParsed.data)
    .eq('tenant_id', tenantId);

  if (error) {
    console.error('[deactivateService]', error);
    return { success: false, error: error.message };
  }

  revalidateCatalog();
  return { success: true };
}

export async function addServicePresets(
  group: keyof typeof SERVICE_PRESETS,
): Promise<{ success: true; added: number } | { success: false; error: string }> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'Not authenticated' };

  const presetGroup = SERVICE_PRESETS[group];
  if (!presetGroup) return { success: false, error: 'Unknown preset group' };

  const supabase = await createClient();
  const sortOrder = await nextSortOrder(supabase, tenantId);
  const rows = presetGroup.services.map((preset: ServicePreset, index: number) => ({
    tenant_id: tenantId,
    name: preset.name,
    default_price: preset.default_price,
    default_duration_minutes: preset.default_duration_minutes,
    default_frequency_days: preset.default_frequency_days,
    is_active: true,
    sort_order: sortOrder + index,
  }));

  const { data, error } = await supabase
    .from('service_catalog')
    .upsert(rows, { onConflict: 'tenant_id,name', ignoreDuplicates: true })
    .select('id');

  if (error) {
    console.error('[addServicePresets]', error);
    return { success: false, error: error.message };
  }

  revalidateCatalog();
  return { success: true, added: data?.length ?? 0 };
}
