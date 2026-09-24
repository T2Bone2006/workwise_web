import type { SupabaseClient } from '@supabase/supabase-js';
import { getRoundsSettings } from '@/lib/data/rounds/settings';
import { compareYmd, todayInLondon, type Ymd } from '@/lib/rounds/dates';
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
import type { AgreementValues } from '@/lib/validations/rounds/agreement';

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

async function loadAgreement(
  supabase: SupabaseClient,
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
  supabase: SupabaseClient,
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
  supabase: SupabaseClient,
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
  if (error) throw new Error(error.message ?? 'Failed to check outstanding visits.');
  return (count ?? 0) > 0;
}

export async function updateAgreementCore(
  supabase: SupabaseClient,
  params: {
    tenantId: string;
    agreementId: string;
    values: AgreementValues;
    applyPriceToFuture: boolean;
  },
): Promise<{ success: true; regenerated: number } | { success: false; error: string }> {
  const existing = await loadAgreement(supabase, params.tenantId, params.agreementId);
  if (!existing) return { success: false, error: 'Agreement not found' };
  if (existing.status === 'ended') {
    return { success: false, error: 'This agreement has ended' };
  }

  const values = params.values;
  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('id')
    .eq('id', values.customer_id)
    .eq('tenant_id', params.tenantId)
    .maybeSingle();
  if (customerError) return { success: false, error: customerError.message };
  if (!customer) return { success: false, error: 'Customer not found' };

  if (values.service_catalog_id) {
    const { data: catalog, error: catalogError } = await supabase
      .from('service_catalog')
      .select('id')
      .eq('id', values.service_catalog_id)
      .eq('tenant_id', params.tenantId)
      .maybeSingle();
    if (catalogError) return { success: false, error: catalogError.message };
    if (!catalog) return { success: false, error: 'Service not found' };
  }

  const today = todayInLondon();
  const changedSchedule = scheduleChanged(existing, values);
  const coords =
    existing.address !== values.address || existing.postcode !== values.postcode
      ? await (async () => {
          const geocoded = await resolveJobCoordinates({
            postcode: values.postcode,
            fullAddress: `${values.address}, ${values.postcode}`,
          });
          return { lat: geocoded?.lat ?? null, lng: geocoded?.lng ?? null };
        })()
      : { lat: existing.lat, lng: existing.lng };

  let nextDueDate = existing.next_due_date;
  let regenerated = 0;

  try {
    if (changedSchedule) {
      await deleteUntouchedFutureVisits(supabase, {
        tenantId: params.tenantId,
        agreementId: existing.id,
        fromDate: today,
      });
      if (values.schedule_mode === 'fixed') {
        nextDueDate = firstOccurrenceOnOrAfter(
          values.anchor_date,
          values.frequency_days,
          today,
        );
      } else if (!(await hasOutstandingVisit(supabase, params.tenantId, existing.id, today))) {
        nextDueDate =
          compareYmd(values.anchor_date, today) >= 0 ? values.anchor_date : today;
      }
    }

    const { error } = await supabase
      .from('service_agreements')
      .update({
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
        next_due_date: nextDueDate,
      })
      .eq('id', existing.id)
      .eq('tenant_id', params.tenantId);

    if (error) return { success: false, error: error.message };

    if (changedSchedule) {
      const updated = await loadAgreement(supabase, params.tenantId, existing.id);
      if (!updated) return { success: false, error: 'Agreement updated but could not be reloaded' };
      if (
        updated.schedule_mode === 'fixed' ||
        !(await hasOutstandingVisit(supabase, params.tenantId, existing.id, today))
      ) {
        regenerated = await generateForAgreement(supabase, params.tenantId, updated);
      }
    } else if (existing.price !== values.price && params.applyPriceToFuture) {
      regenerated = await repriceUntouchedFutureVisits(supabase, {
        tenantId: params.tenantId,
        agreementId: existing.id,
        fromDate: today,
        price: values.price,
      });
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to update agreement',
    };
  }

  return { success: true, regenerated };
}
