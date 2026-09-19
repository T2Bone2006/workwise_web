'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getRoundsSettings } from '@/lib/data/rounds/settings';
import { addDays, compareYmd, isValidYmd, todayInLondon, type Ymd } from '@/lib/rounds/dates';
import { createAgreementCore } from '@/lib/rounds/create-agreement';
import {
  AGREEMENT_COLUMNS,
  generateVisitsForAgreement,
  mapAgreementRow,
  type AgreementRow,
} from '@/lib/rounds/generate-visits';
import { firstOccurrenceOnOrAfter } from '@/lib/rounds/recurrence';
import { getSoloWorkerForTenant } from '@/lib/rounds/rounds-worker';
import {
  deleteUntouchedFutureVisits,
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
  revalidatePath('/rounds');
  revalidatePath('/dashboard');
  revalidatePath('/rounds/calendar');
  revalidatePath(`/rounds/customers/${customerId}`);
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
  const existing = await loadAgreement(supabase, tenantId, idParsed.data);
  if (!existing) return { success: false, error: 'Agreement not found' };
  if (existing.status === 'ended') {
    return { success: false, error: 'This agreement has ended' };
  }

  const customerCheck = await assertCustomer(supabase, tenantId, values.customer_id);
  if (!customerCheck.success) return customerCheck;
  const catalogCheck = await assertCatalog(supabase, tenantId, values.service_catalog_id);
  if (!catalogCheck.success) return catalogCheck;

  const today = todayInLondon();
  const changedSchedule = scheduleChanged(existing, values);
  const coords =
    existing.address !== values.address || existing.postcode !== values.postcode
      ? await geocodeAgreement(values)
      : { lat: existing.lat, lng: existing.lng };

  let nextDueDate = existing.next_due_date;
  let regenerated = 0;

  try {
    if (changedSchedule) {
      await deleteUntouchedFutureVisits(supabase, {
        tenantId,
        agreementId: existing.id,
        fromDate: today,
      });

      if (values.schedule_mode === 'fixed') {
        nextDueDate = firstOccurrenceOnOrAfter(
          values.anchor_date,
          values.frequency_days,
          today,
        );
      } else if (!(await hasOutstandingVisit(supabase, tenantId, existing.id, today))) {
        nextDueDate = afterCompletionCursor(values.anchor_date, today);
      }
    }

    const { error } = await supabase
      .from('service_agreements')
      .update({
        ...agreementWriteFields(values, coords),
        next_due_date: nextDueDate,
      })
      .eq('id', existing.id)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error('[updateAgreement]', error);
      return { success: false, error: error.message };
    }

    if (changedSchedule) {
      const updated = await loadAgreement(supabase, tenantId, existing.id);
      if (!updated) return { success: false, error: 'Agreement updated but could not be reloaded' };
      if (updated.schedule_mode === 'fixed' || !(await hasOutstandingVisit(supabase, tenantId, existing.id, today))) {
        regenerated = await generateForAgreement(supabase, tenantId, updated);
      }
    } else if (existing.price !== values.price && opts.applyPriceToFuture) {
      regenerated = await repriceUntouchedFutureVisits(supabase, {
        tenantId,
        agreementId: existing.id,
        fromDate: today,
        price: values.price,
      });
    }
  } catch (err) {
    console.error('[updateAgreement]', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to update agreement',
    };
  }

  revalidateAgreement(values.customer_id);
  return { success: true, regenerated };
}

export async function pauseAgreement(
  id: string,
  pausedUntil: Ymd | null,
): Promise<ActionResult> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'Not authenticated' };

  const idParsed = uuidSchema.safeParse(id);
  if (!idParsed.success) return { success: false, error: firstZodError(idParsed.error) };
  if (pausedUntil != null && !isValidYmd(pausedUntil)) {
    return { success: false, error: 'Invalid pause date' };
  }

  const supabase = await createClient();
  const existing = await loadAgreement(supabase, tenantId, idParsed.data);
  if (!existing) return { success: false, error: 'Agreement not found' };
  if (existing.status === 'ended') {
    return { success: false, error: 'This agreement has ended' };
  }

  const today = todayInLondon();
  let nextDueDate = existing.next_due_date;
  if (pausedUntil) {
    nextDueDate = firstOccurrenceOnOrAfter(
      existing.next_due_date,
      existing.frequency_days,
      addDays(pausedUntil, 1),
    );
  }

  try {
    await deleteUntouchedFutureVisits(supabase, {
      tenantId,
      agreementId: existing.id,
      fromDate: today,
      toDate: pausedUntil ?? undefined,
    });

    const { error } = await supabase
      .from('service_agreements')
      .update({
        status: 'paused',
        paused_until: pausedUntil,
        next_due_date: nextDueDate,
      })
      .eq('id', existing.id)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error('[pauseAgreement]', error);
      return { success: false, error: error.message };
    }
  } catch (err) {
    console.error('[pauseAgreement]', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to pause agreement',
    };
  }

  revalidateAgreement(existing.customer_id);
  return { success: true };
}

export async function resumeAgreement(id: string): Promise<ActionResult> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'Not authenticated' };

  const idParsed = uuidSchema.safeParse(id);
  if (!idParsed.success) return { success: false, error: firstZodError(idParsed.error) };

  const supabase = await createClient();
  const existing = await loadAgreement(supabase, tenantId, idParsed.data);
  if (!existing) return { success: false, error: 'Agreement not found' };
  if (existing.status === 'ended') {
    return { success: false, error: 'This agreement has ended' };
  }

  const today = todayInLondon();
  const nextDueDate = firstOccurrenceOnOrAfter(
    existing.next_due_date,
    existing.frequency_days,
    today,
  );

  const { error } = await supabase
    .from('service_agreements')
    .update({
      status: 'active',
      paused_until: null,
      next_due_date: nextDueDate,
    })
    .eq('id', existing.id)
    .eq('tenant_id', tenantId);

  if (error) {
    console.error('[resumeAgreement]', error);
    return { success: false, error: error.message };
  }

  const updated = await loadAgreement(supabase, tenantId, existing.id);
  if (!updated) return { success: false, error: 'Agreement resumed but could not be reloaded' };

  try {
    await generateForAgreement(supabase, tenantId, updated);
  } catch (err) {
    console.error('[resumeAgreement] generate', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to generate visits',
    };
  }

  revalidateAgreement(existing.customer_id);
  return { success: true };
}

export async function endAgreement(id: string): Promise<ActionResult> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'Not authenticated' };

  const idParsed = uuidSchema.safeParse(id);
  if (!idParsed.success) return { success: false, error: firstZodError(idParsed.error) };

  const supabase = await createClient();
  const existing = await loadAgreement(supabase, tenantId, idParsed.data);
  if (!existing) return { success: false, error: 'Agreement not found' };
  if (existing.status === 'ended') return { success: true };

  const today = todayInLondon();
  try {
    await deleteUntouchedFutureVisits(supabase, {
      tenantId,
      agreementId: existing.id,
      fromDate: today,
    });

    const { error } = await supabase
      .from('service_agreements')
      .update({
        status: 'ended',
        ended_at: new Date().toISOString(),
        paused_until: null,
      })
      .eq('id', existing.id)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error('[endAgreement]', error);
      return { success: false, error: error.message };
    }
  } catch (err) {
    console.error('[endAgreement]', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to end agreement',
    };
  }

  revalidateAgreement(existing.customer_id);
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
