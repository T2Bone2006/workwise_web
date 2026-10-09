'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getRoundsSettings } from '@/lib/data/rounds/settings';
import { compareYmd, type Ymd } from '@/lib/rounds/dates';
import { createAgreementCore } from '@/lib/rounds/create-agreement';
import { endAgreementCore } from '@/lib/rounds/end-agreement';
import { pauseAgreementCore, resumeAgreementCore } from '@/lib/rounds/pause-agreement';
import { setCustomerHouseCore } from '@/lib/rounds/customer-house';
import { updateAgreementCore } from '@/lib/rounds/update-agreement';
import {
  AGREEMENT_COLUMNS,
  generateVisitsForAgreement,
  mapAgreementRow,
  type AgreementRow,
} from '@/lib/rounds/generate-visits';
import { getSoloWorkerForTenant } from '@/lib/rounds/rounds-worker';
import {
  repriceUntouchedFutureVisits,
  RESCHEDULE_STATUSES,
} from '@/lib/rounds/visit-transitions';
import { resolveJobCoordinates } from '@/lib/utils/geocoding';
import {
  agreementSchema,
  type AgreementInput,
  type AgreementValues,
} from '@/lib/validations/rounds/agreement';

export type ActionResult = { success: true } | { success: false; error: string };

const uuidSchema = z.string().uuid('Invalid agreement');

function firstZodError(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid input';
}

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

function timeKey(value: string | null | undefined): string | null {
  const time = timeOrNull(value);
  return time ? time.slice(0, 5) : null;
}

function afterCompletionCursor(anchorDate: Ymd, today: Ymd): Ymd {
  return compareYmd(anchorDate, today) >= 0 ? anchorDate : today;
}

function scheduleChanged(existing: AgreementRow, values: AgreementValues): boolean {
  return (
    existing.frequency_days !== values.frequency_days ||
    existing.anchor_date !== values.anchor_date ||
    (existing.preferred_weekday ?? null) !== weekdayOrNull(values.preferred_weekday) ||
    timeKey(existing.preferred_time) !== timeKey(values.preferred_time) ||
    existing.address !== values.address ||
    existing.postcode !== values.postcode ||
    existing.schedule_mode !== values.schedule_mode
  );
}

function revalidateAgreement(customerId: string) {
  revalidatePath('/dashboard');
  revalidatePath('/calendar');
  revalidatePath('/customers');
  revalidatePath(`/customers/${customerId}`);
}

async function loadAgreement(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  agreementId: string,
): Promise<AgreementRow | null> {
  const { data, error } = await supabase
    .from('service_agreements')
    .select(AGREEMENT_COLUMNS)
    .eq('id', agreementId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error || !data) return null;
  return mapAgreementRow(data as unknown as Record<string, unknown>);
}

async function generateForAgreement(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  agreement: AgreementRow,
): Promise<number> {
  const [settings, solo] = await Promise.all([
    getRoundsSettings(supabase, tenantId),
    getSoloWorkerForTenant(supabase, tenantId),
  ]);
  const result = await generateVisitsForAgreement(supabase, {
    tenantId,
    agreement,
    settings,
    workerId: agreement.assigned_worker_id ?? solo?.id ?? null,
  });
  return result.inserted;
}

async function hasOutstandingVisit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  agreementId: string,
  today: Ymd,
): Promise<boolean> {
  const { count, error } = await supabase
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('service_agreement_id', agreementId)
    .in('status', [...RESCHEDULE_STATUSES])
    .gte('scheduled_date', today);
  if (error) {
    throw new Error(error.message ?? 'Failed to check outstanding visits.');
  }
  return (count ?? 0) > 0;
}

function agreementWriteFields(values: AgreementValues, coords: {
  lat: number | null;
  lng: number | null;
}) {
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
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  customerId: string,
): Promise<ActionResult> {
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
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  catalogId: string | null | undefined,
): Promise<ActionResult> {
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

export async function createAgreement(
  input: AgreementInput,
): Promise<{ success: true; id: string; generated: number } | { success: false; error: string }> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'Not authenticated' };

  const parsed = agreementSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };
  const values = parsed.data;

  const supabase = await createClient();
  const result = await createAgreementCore(supabase, { tenantId, values });
  if (!result.success) return result;

  revalidateAgreement(values.customer_id);
  return result;
}

export async function updateAgreement(
  id: string,
  input: AgreementInput,
  opts: { applyPriceToFuture: boolean },
): Promise<{ success: true; regenerated: number } | { success: false; error: string }> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'Not authenticated' };

  const idParsed = uuidSchema.safeParse(id);
  if (!idParsed.success) return { success: false, error: firstZodError(idParsed.error) };

  const parsed = agreementSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };
  const values = parsed.data;

  const supabase = await createClient();
  const result = await updateAgreementCore(supabase, {
    tenantId,
    agreementId: idParsed.data,
    values,
    applyPriceToFuture: opts.applyPriceToFuture,
  });
  if (!result.success) return result;

  revalidateAgreement(values.customer_id);
  return { success: true, regenerated: result.regenerated };
}

export async function pauseAgreement(
  id: string,
  pausedUntil: Ymd | null,
): Promise<ActionResult> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'Not authenticated' };

  const idParsed = uuidSchema.safeParse(id);
  if (!idParsed.success) return { success: false, error: firstZodError(idParsed.error) };

  const supabase = await createClient();
  const result = await pauseAgreementCore(supabase, {
    tenantId,
    agreementId: idParsed.data,
    pausedUntil,
  });
  if (!result.success) return result;

  revalidateAgreement(result.customerId);
  return { success: true };
}

export async function resumeAgreement(id: string): Promise<ActionResult> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'Not authenticated' };

  const idParsed = uuidSchema.safeParse(id);
  if (!idParsed.success) return { success: false, error: firstZodError(idParsed.error) };

  const supabase = await createClient();
  const result = await resumeAgreementCore(supabase, { tenantId, agreementId: idParsed.data });
  if (!result.success) return result;

  revalidateAgreement(result.customerId);
  return { success: true };
}

export async function endAgreement(id: string): Promise<ActionResult> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'Not authenticated' };

  const idParsed = uuidSchema.safeParse(id);
  if (!idParsed.success) return { success: false, error: firstZodError(idParsed.error) };

  const supabase = await createClient();
  const result = await endAgreementCore(supabase, {
    tenantId,
    agreementId: idParsed.data,
  });
  if (!result.success) return result;

  revalidateAgreement(result.customerId);
  return { success: true };
}

export async function regenerateAgreementVisits(
  id: string,
): Promise<{ success: true; inserted: number } | { success: false; error: string }> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'Not authenticated' };

  const idParsed = uuidSchema.safeParse(id);
  if (!idParsed.success) return { success: false, error: firstZodError(idParsed.error) };

  const supabase = await createClient();
  const existing = await loadAgreement(supabase, tenantId, idParsed.data);
  if (!existing) return { success: false, error: 'Agreement not found' };
  if (existing.status !== 'active') {
    return { success: false, error: 'Only active agreements can generate visits' };
  }

  let inserted = 0;
  try {
    inserted = await generateForAgreement(supabase, tenantId, existing);
  } catch (err) {
    console.error('[regenerateAgreementVisits]', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to generate visits',
    };
  }

  revalidateAgreement(existing.customer_id);
  return { success: true, inserted };
}

/** The house belongs to the customer. Services at that address follow it; services at another property keep theirs. */
export async function setCustomerHouse(
  customerId: string,
  address: string,
  postcode: string,
  pin?: { lat: number; lng: number } | null,
): Promise<ActionResult> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'Not authenticated' };

  const parsed = agreementSchema
    .pick({ address: true, postcode: true, pin_lat: true, pin_lng: true })
    .safeParse({ address, postcode, pin_lat: pin?.lat, pin_lng: pin?.lng });
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const result = await setCustomerHouseCore(supabase, {
    tenantId,
    customerId,
    address: parsed.data.address,
    postcode: parsed.data.postcode,
    pin:
      parsed.data.pin_lat != null && parsed.data.pin_lng != null
        ? { lat: parsed.data.pin_lat, lng: parsed.data.pin_lng }
        : null,
  });
  if (!result.success) return result;

  revalidateAgreement(customerId);
  return { success: true };
}
