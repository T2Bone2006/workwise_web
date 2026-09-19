import type { SupabaseClient } from '@supabase/supabase-js';
import { getRoundsSettings } from '@/lib/data/rounds/settings';
import { compareYmd, todayInLondon, type Ymd } from '@/lib/rounds/dates';
import {
  buildVisitInsert,
  firstOccurrenceOnOrAfter,
  horizonEnd,
  nextDueAfter,
  occurrencesFrom,
  planVisits,
  type AgreementSchedule,
} from '@/lib/rounds/recurrence';
import { getSoloWorkerForTenant } from '@/lib/rounds/rounds-worker';
import type { RoundsSettings } from '@/lib/rounds/settings';

export const AGREEMENT_COLUMNS = [
  'id',
  'tenant_id',
  'customer_id',
  'service_catalog_id',
  'title',
  'address',
  'postcode',
  'lat',
  'lng',
  'price',
  'duration_minutes',
  'frequency_days',
  'anchor_date',
  'preferred_weekday',
  'preferred_time',
  'schedule_mode',
  'next_due_date',
  'last_generated_at',
  'status',
  'paused_until',
  'ended_at',
  'assigned_worker_id',
  'default_payment_method',
  'reminder_enabled',
  'access_notes',
  'notes',
  'created_at',
  'updated_at',
].join(', ');

const OUTSTANDING_STATUSES = [
  'assigned',
  'accepted',
  'en_route',
  'arrived',
  'in_progress',
  'paused',
] as const;

export type AgreementRow = {
  id: string;
  tenant_id: string;
  customer_id: string;
  service_catalog_id: string | null;
  title: string;
  address: string;
  postcode: string;
  lat: number | null;
  lng: number | null;
  price: number;
  duration_minutes: number;
  frequency_days: number;
  anchor_date: Ymd;
  preferred_weekday: number | null;
  preferred_time: string | null;
  schedule_mode: 'fixed' | 'after_completion';
  next_due_date: Ymd;
  last_generated_at: string | null;
  status: 'active' | 'paused' | 'ended';
  paused_until: Ymd | null;
  ended_at: string | null;
  assigned_worker_id: string | null;
  default_payment_method:
    | 'cash'
    | 'bank_transfer'
    | 'card'
    | 'cheque'
    | 'other'
    | null;
  reminder_enabled: boolean;
  access_notes: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type GenerateResult = {
  inserted: number;
  droppedPast: number;
  nextDueDate: Ymd;
};

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asYmd(value: unknown): Ymd | null {
  return typeof value === 'string' && value.length >= 10 ? value.slice(0, 10) : null;
}

function asScheduleMode(value: unknown): AgreementRow['schedule_mode'] | null {
  if (value === 'fixed' || value === 'after_completion') return value;
  return null;
}

function asStatus(value: unknown): AgreementRow['status'] | null {
  if (value === 'active' || value === 'paused' || value === 'ended') return value;
  return null;
}

function asPaymentMethod(value: unknown): AgreementRow['default_payment_method'] {
  if (
    value === 'cash' ||
    value === 'bank_transfer' ||
    value === 'card' ||
    value === 'cheque' ||
    value === 'other'
  ) {
    return value;
  }
  return null;
}

function weekdayOrNull(value: unknown): number | null {
  const n = asFiniteNumber(value);
  if (n == null || n < 1 || n > 7) return null;
  return n;
}

export function mapAgreementRow(raw: Record<string, unknown>): AgreementRow | null {
  const id = typeof raw.id === 'string' ? raw.id : null;
  const tenantId = typeof raw.tenant_id === 'string' ? raw.tenant_id : null;
  const customerId = typeof raw.customer_id === 'string' ? raw.customer_id : null;
  const title = typeof raw.title === 'string' ? raw.title : null;
  const address = typeof raw.address === 'string' ? raw.address : null;
  const postcode = typeof raw.postcode === 'string' ? raw.postcode : null;
  const frequencyDays = asFiniteNumber(raw.frequency_days);
  const durationMinutes = asFiniteNumber(raw.duration_minutes);
  const price = asFiniteNumber(raw.price);
  const anchorDate = asYmd(raw.anchor_date);
  const nextDueDate = asYmd(raw.next_due_date);
  const scheduleMode = asScheduleMode(raw.schedule_mode);
  const status = asStatus(raw.status);
  if (
    !id ||
    !tenantId ||
    !customerId ||
    !title ||
    !address ||
    !postcode ||
    frequencyDays == null ||
    durationMinutes == null ||
    price == null ||
    !anchorDate ||
    !nextDueDate ||
    !scheduleMode ||
    !status
  ) {
    return null;
  }

  const preferredWeekday = weekdayOrNull(raw.preferred_weekday);

  return {
    id,
    tenant_id: tenantId,
    customer_id: customerId,
    service_catalog_id:
      typeof raw.service_catalog_id === 'string' ? raw.service_catalog_id : null,
    title,
    address,
    postcode,
    lat: asFiniteNumber(raw.lat),
    lng: asFiniteNumber(raw.lng),
    price,
    duration_minutes: durationMinutes,
    frequency_days: frequencyDays,
    anchor_date: anchorDate,
    preferred_weekday: preferredWeekday,
    preferred_time: typeof raw.preferred_time === 'string' ? raw.preferred_time : null,
    schedule_mode: scheduleMode,
    next_due_date: nextDueDate,
    last_generated_at:
      typeof raw.last_generated_at === 'string' ? raw.last_generated_at : null,
    status,
    paused_until: asYmd(raw.paused_until),
    ended_at: typeof raw.ended_at === 'string' ? raw.ended_at : null,
    assigned_worker_id:
      typeof raw.assigned_worker_id === 'string' ? raw.assigned_worker_id : null,
    default_payment_method: asPaymentMethod(raw.default_payment_method),
    reminder_enabled: raw.reminder_enabled !== false,
    access_notes: typeof raw.access_notes === 'string' ? raw.access_notes : null,
    notes: typeof raw.notes === 'string' ? raw.notes : null,
    created_at: typeof raw.created_at === 'string' ? raw.created_at : null,
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : null,
  };
}

function toSchedule(agreement: AgreementRow): AgreementSchedule {
  return {
    id: agreement.id,
    frequency_days: agreement.frequency_days,
    next_due_date: agreement.next_due_date,
    preferred_weekday: agreement.preferred_weekday,
    preferred_time: agreement.preferred_time,
    schedule_mode: agreement.schedule_mode,
    status: agreement.status,
    paused_until: agreement.paused_until,
  };
}

async function catalogName(
  supabase: SupabaseClient,
  catalogId: string | null,
): Promise<string | null> {
  if (!catalogId) return null;
  const { data, error } = await supabase
    .from('service_catalog')
    .select('name')
    .eq('id', catalogId)
    .maybeSingle();
  if (error) {
    console.error('[generateVisitsForAgreement] service_catalog select error:', error);
    return null;
  }
  return typeof data?.name === 'string' ? data.name : null;
}

async function fetchAgreements(
  supabase: SupabaseClient,
  tenantId: string,
  status: 'active' | 'paused',
  pausedUntilOnOrBefore?: Ymd,
): Promise<AgreementRow[]> {
  let query = supabase
    .from('service_agreements')
    .select(AGREEMENT_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('status', status);

  if (status === 'paused' && pausedUntilOnOrBefore) {
    query = query.not('paused_until', 'is', null).lte('paused_until', pausedUntilOnOrBefore);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message ?? 'Failed to load service agreements.');
  }
  const rows: AgreementRow[] = [];
  for (const raw of data ?? []) {
    const mapped = mapAgreementRow(raw as unknown as Record<string, unknown>);
    if (mapped) rows.push(mapped);
  }
  return rows;
}

export async function generateVisitsForAgreement(
  supabase: SupabaseClient,
  params: {
    tenantId: string;
    agreement: AgreementRow;
    settings: RoundsSettings;
    workerId: string | null;
    today?: Ymd;
  },
): Promise<GenerateResult> {
  const today = params.today ?? todayInLondon();
  const { visits, lastOccurrence } = planVisits(
    toSchedule(params.agreement),
    params.settings,
    today,
  );

  if (visits.length === 0 && lastOccurrence == null) {
    return {
      inserted: 0,
      droppedPast: 0,
      nextDueDate: params.agreement.next_due_date,
    };
  }

  const considered = lastOccurrence
    ? occurrencesFrom(
        params.agreement.next_due_date,
        params.agreement.frequency_days,
        lastOccurrence,
      )
    : [];
  const droppedPast = Math.max(0, considered.length - visits.length);

  let inserted = 0;
  if (visits.length > 0) {
    const serviceName = await catalogName(supabase, params.agreement.service_catalog_id);
    const workerId = params.agreement.assigned_worker_id ?? params.workerId;
    const rows = visits.map((visit) =>
      buildVisitInsert({
        tenantId: params.tenantId,
        visit,
        workerId,
        agreement: {
          id: params.agreement.id,
          customer_id: params.agreement.customer_id,
          title: params.agreement.title,
          address: params.agreement.address,
          postcode: params.agreement.postcode,
          lat: params.agreement.lat,
          lng: params.agreement.lng,
          price: params.agreement.price,
          duration_minutes: params.agreement.duration_minutes,
          preferred_time: params.agreement.preferred_time,
          access_notes: params.agreement.access_notes,
          service_name: serviceName,
        },
      }),
    );

    const { data: insertedRows, error: upsertError } = await supabase
      .from('jobs')
      .upsert(rows, {
        onConflict: 'service_agreement_id,agreement_occurrence_date',
        ignoreDuplicates: true,
      })
      .select('id');

    if (upsertError) {
      throw new Error(upsertError.message ?? 'Failed to insert generated visits.');
    }

    const ids = (insertedRows ?? [])
      .map((row) => (typeof row.id === 'string' ? row.id : null))
      .filter((id): id is string => id != null);
    inserted = ids.length;

    if (ids.length > 0) {
      const { error: historyError } = await supabase.from('job_status_history').insert(
        ids.map((jobId) => ({
          job_id: jobId,
          from_status: null,
          to_status: 'assigned',
          notes: 'Generated from agreement',
          metadata: { agreement_id: params.agreement.id },
        })),
      );
      if (historyError) {
        console.error(
          '[generateVisitsForAgreement] job_status_history insert error:',
          historyError,
        );
      }
    }
  }

  if (lastOccurrence == null) {
    return {
      inserted,
      droppedPast,
      nextDueDate: params.agreement.next_due_date,
    };
  }

  const next = nextDueAfter(lastOccurrence, params.agreement.frequency_days);
  const patch: { last_generated_at: string; next_due_date?: Ymd } = {
    last_generated_at: new Date().toISOString(),
  };
  let nextDueDate = params.agreement.next_due_date;
  if (compareYmd(next, params.agreement.next_due_date) > 0) {
    patch.next_due_date = next;
    nextDueDate = next;
  }

  const { error: updateError } = await supabase
    .from('service_agreements')
    .update(patch)
    .eq('id', params.agreement.id)
    .eq('tenant_id', params.tenantId);

  if (updateError) {
    throw new Error(updateError.message ?? 'Failed to advance agreement cursor.');
  }

  return { inserted, droppedPast, nextDueDate };
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
    .in('status', [...OUTSTANDING_STATUSES])
    .gte('scheduled_date', today);

  if (error) {
    throw new Error(error.message ?? 'Failed to check outstanding visits.');
  }
  return (count ?? 0) > 0;
}

export async function generateVisitsForTenant(
  supabase: SupabaseClient,
  params: { tenantId: string; today?: Ymd },
): Promise<{ agreements: number; inserted: number; resumed: number }> {
  const today = params.today ?? todayInLondon();
  const [settings, solo] = await Promise.all([
    getRoundsSettings(supabase, params.tenantId),
    getSoloWorkerForTenant(supabase, params.tenantId),
  ]);
  const workerId = solo?.id ?? null;
  const horizon = horizonEnd(today, settings);

  const pausedDue = await fetchAgreements(
    supabase,
    params.tenantId,
    'paused',
    today,
  );

  let resumed = 0;
  for (const agreement of pausedDue) {
    const nextDueDate = firstOccurrenceOnOrAfter(
      agreement.next_due_date,
      agreement.frequency_days,
      today,
    );
    const { error } = await supabase
      .from('service_agreements')
      .update({
        status: 'active',
        paused_until: null,
        next_due_date: nextDueDate,
      })
      .eq('id', agreement.id)
      .eq('tenant_id', params.tenantId);
    if (error) {
      console.error('[generateVisitsForTenant] resume error:', agreement.id, error);
      continue;
    }
    resumed += 1;
  }

  const active = await fetchAgreements(supabase, params.tenantId, 'active');

  let agreements = 0;
  let inserted = 0;
  for (const agreement of active) {
    try {
      if (agreement.schedule_mode === 'fixed') {
        if (compareYmd(agreement.next_due_date, horizon) > 0) continue;
      } else if (agreement.schedule_mode === 'after_completion') {
        if (await hasOutstandingVisit(supabase, params.tenantId, agreement.id, today)) {
          continue;
        }
      } else {
        continue;
      }

      agreements += 1;
      const result = await generateVisitsForAgreement(supabase, {
        tenantId: params.tenantId,
        agreement,
        settings,
        workerId,
        today,
      });
      inserted += result.inserted;
    } catch (err) {
      console.error('[generateVisitsForTenant] agreement', agreement.id, err);
    }
  }

  return { agreements, inserted, resumed };
}
