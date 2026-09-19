import type { SupabaseClient } from '@supabase/supabase-js';
import { getRoundsSettings } from '@/lib/data/rounds/settings';
import {
  AGREEMENT_COLUMNS,
  generateVisitsForAgreement,
  mapAgreementRow,
} from '@/lib/rounds/generate-visits';
import { getSoloWorkerForTenant } from '@/lib/rounds/rounds-worker';
import { resolveJobCoordinates } from '@/lib/utils/geocoding';
import type { AgreementValues } from '@/lib/validations/rounds/agreement';

export type CreateAgreementResult =
  | { success: true; id: string; generated: number }
  | { success: false; error: string };

function emptyToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function weekdayOrNull(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (value < 1 || value > 7) return null;
  return value;
}

function timeOrNull(value: string | null | undefined): string | null {
  return emptyToNull(value);
}

function agreementWriteFields(
  values: AgreementValues,
  coords: { lat: number | null; lng: number | null },
) {
  return {
    customer_id: values.customer_id,
    service_catalog_id: values.service_catalog_id ?? null,
    title: values.title,
    address: values.address,
    postcode: values.postcode,
    lat: coords.lat,
    lng: coords.lng,
    price: values.price,
    duration_minutes: values.duration_minutes,
    frequency_days: values.frequency_days,
    schedule_mode: values.schedule_mode,
    anchor_date: values.anchor_date,
    preferred_weekday: weekdayOrNull(values.preferred_weekday),
    preferred_time: timeOrNull(values.preferred_time),
    default_payment_method: values.default_payment_method ?? null,
    reminder_enabled: values.reminder_enabled,
    access_notes: emptyToNull(values.access_notes),
    notes: emptyToNull(values.notes),
  };
}

async function geocodeAgreement(values: AgreementValues): Promise<{
  lat: number | null;
  lng: number | null;
}> {
  const coords = await resolveJobCoordinates({
    postcode: values.postcode,
    fullAddress: `${values.address}, ${values.postcode}`,
  });
  return { lat: coords?.lat ?? null, lng: coords?.lng ?? null };
}

async function assertCustomer(
  supabase: SupabaseClient,
  tenantId: string,
  customerId: string,
): Promise<CreateAgreementResult | { success: true }> {
  const { data, error } = await supabase
    .from('customers')
    .select('id')
    .eq('id', customerId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: 'Customer not found' };
  return { success: true };
}

async function assertCatalog(
  supabase: SupabaseClient,
  tenantId: string,
  catalogId: string | null | undefined,
): Promise<CreateAgreementResult | { success: true }> {
  if (!catalogId) return { success: true };
  const { data, error } = await supabase
    .from('service_catalog')
    .select('id')
    .eq('id', catalogId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: 'Service not found' };
  return { success: true };
}

/**
 * Insert an agreement and generate its visits. Shared by the dashboard action
 * and the phone bearer APIs. Not a server action — caller supplies supabase.
 */
export async function createAgreementCore(
  supabase: SupabaseClient,
  params: { tenantId: string; values: AgreementValues },
): Promise<CreateAgreementResult> {
  const { tenantId, values } = params;

  const customerCheck = await assertCustomer(supabase, tenantId, values.customer_id);
  if (!customerCheck.success) return customerCheck;
  const catalogCheck = await assertCatalog(supabase, tenantId, values.service_catalog_id);
  if (!catalogCheck.success) return catalogCheck;

  const coords = await geocodeAgreement(values);
  const solo = await getSoloWorkerForTenant(supabase, tenantId);

  const { data, error } = await supabase
    .from('service_agreements')
    .insert({
      tenant_id: tenantId,
      ...agreementWriteFields(values, coords),
      next_due_date: values.anchor_date,
      status: 'active',
      assigned_worker_id: solo?.id ?? null,
    })
    .select(AGREEMENT_COLUMNS)
    .single();

  if (error || !data) {
    console.error('[createAgreementCore]', error);
    return { success: false, error: error?.message ?? 'Failed to create agreement' };
  }

  const agreement = mapAgreementRow(data as unknown as Record<string, unknown>);
  if (!agreement) {
    return { success: false, error: 'Agreement saved but could not be read back' };
  }

  try {
    const settings = await getRoundsSettings(supabase, tenantId);
    const generated = await generateVisitsForAgreement(supabase, {
      tenantId,
      agreement,
      settings,
      workerId: agreement.assigned_worker_id ?? solo?.id ?? null,
    });
    return { success: true, id: agreement.id, generated: generated.inserted };
  } catch (err) {
    console.error('[createAgreementCore] generate', err);
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : 'Agreement saved but visits could not be generated',
    };
  }
}

export async function jobIdsForAgreement(
  supabase: SupabaseClient,
  params: { tenantId: string; agreementId: string },
): Promise<string[]> {
  const { data, error } = await supabase
    .from('jobs')
    .select('id')
    .eq('tenant_id', params.tenantId)
    .eq('service_agreement_id', params.agreementId);
  if (error) {
    console.error('[jobIdsForAgreement]', error);
    return [];
  }
  return (data ?? [])
    .map((row) => (typeof row.id === 'string' ? row.id : null))
    .filter((id): id is string => id != null);
}
