import { addDays, compareYmd, isoWeekday, type Ymd } from './dates';
import type { RoundsSettings } from './settings';

export type AgreementSchedule = {
  id: string;
  frequency_days: number;
  next_due_date: Ymd;
  preferred_weekday: number | null;
  preferred_time: string | null;
  schedule_mode: 'fixed' | 'after_completion';
  status: 'active' | 'paused' | 'ended';
  paused_until: Ymd | null;
};

export type PlannedVisit = { occurrenceDate: Ymd; scheduledDate: Ymd };

const MAX_SHIFT_TRIES = 14;

export function horizonEnd(today: Ymd, settings: RoundsSettings): Ymd {
  return addDays(today, settings.horizon_weeks * 7);
}

export function occurrencesFrom(
  nextDueDate: Ymd,
  frequencyDays: number,
  untilInclusive: Ymd
): Ymd[] {
  if (frequencyDays < 1) return [];
  const dates: Ymd[] = [];
  let cursor = nextDueDate;
  while (compareYmd(cursor, untilInclusive) <= 0) {
    dates.push(cursor);
    cursor = addDays(cursor, frequencyDays);
  }
  return dates;
}

export function snapToPreferredWeekday(date: Ymd, preferredWeekday: number | null): Ymd {
  if (preferredWeekday == null || preferredWeekday < 1 || preferredWeekday > 7) {
    return date;
  }
  const current = isoWeekday(date);
  const forward = (preferredWeekday - current + 7) % 7;
  const back = (current - preferredWeekday + 7) % 7;
  if (forward === 0) return date;
  // Nearest within ±3; exact tie → the later date.
  if (forward <= 3 && forward <= back) return addDays(date, forward);
  if (back <= 3) return addDays(date, -back);
  return date;
}

export function shiftForWorkingDaysAndBlackouts(date: Ymd, settings: RoundsSettings): Ymd {
  if (!settings.shift_off_non_working_days) return date;

  const working = new Set(settings.working_days);
  const blackouts = new Set(settings.blackouts);
  const isOk = (candidate: Ymd) =>
    working.has(isoWeekday(candidate)) && !blackouts.has(candidate);

  for (let i = 0; i < MAX_SHIFT_TRIES; i++) {
    const candidate = addDays(date, i);
    if (isOk(candidate)) return candidate;
  }
  return date;
}

function placeOnCalendar(
  occurrence: Ymd,
  preferredWeekday: number | null,
  settings: RoundsSettings
): Ymd {
  return shiftForWorkingDaysAndBlackouts(
    snapToPreferredWeekday(occurrence, preferredWeekday),
    settings
  );
}

/** How many dates to show past the visits that already exist as jobs. */
export const FORECAST_VISIT_COUNT = 2;

/**
 * Dates to show on a customer before a job exists.
 * `fixed` counts the next two from the agreement cursor (that cursor already
 * sits after any visits the 8-week generator has written).
 * `after_completion` shows only the one next date, and only when no visit
 * is already booked — the date after that depends on when the clean is done.
 */
export function forecastVisits(
  agreement: AgreementSchedule,
  settings: RoundsSettings,
  today: Ymd,
  bookedOccurrenceDates: ReadonlySet<Ymd> = new Set(),
): PlannedVisit[] {
  if (agreement.status !== 'active' || agreement.frequency_days < 1) {
    return [];
  }

  if (agreement.schedule_mode === 'after_completion') {
    if (bookedOccurrenceDates.size > 0) return [];
    const occurrenceDate = agreement.next_due_date;
    if (bookedOccurrenceDates.has(occurrenceDate)) return [];
    let scheduledDate = placeOnCalendar(
      occurrenceDate,
      agreement.preferred_weekday,
      settings,
    );
    if (compareYmd(scheduledDate, today) < 0) {
      scheduledDate = shiftForWorkingDaysAndBlackouts(today, settings);
    }
    return [{ occurrenceDate, scheduledDate }];
  }

  const start =
    compareYmd(agreement.next_due_date, today) < 0
      ? firstOccurrenceOnOrAfter(
          agreement.next_due_date,
          agreement.frequency_days,
          today,
        )
      : agreement.next_due_date;

  const visits: PlannedVisit[] = [];
  let cursor = start;
  for (let guard = 0; visits.length < FORECAST_VISIT_COUNT && guard < 24; guard += 1) {
    if (!bookedOccurrenceDates.has(cursor)) {
      const scheduledDate = placeOnCalendar(
        cursor,
        agreement.preferred_weekday,
        settings,
      );
      if (compareYmd(scheduledDate, today) >= 0) {
        visits.push({ occurrenceDate: cursor, scheduledDate });
      }
    }
    cursor = addDays(cursor, agreement.frequency_days);
  }
  return visits;
}

export function planVisits(
  agreement: AgreementSchedule,
  settings: RoundsSettings,
  today: Ymd
): { visits: PlannedVisit[]; lastOccurrence: Ymd | null } {
  if (agreement.status !== 'active') {
    return { visits: [], lastOccurrence: null };
  }

  if (agreement.schedule_mode === 'after_completion') {
    const occurrence = agreement.next_due_date;
    let scheduled = placeOnCalendar(occurrence, agreement.preferred_weekday, settings);
    if (compareYmd(scheduled, today) < 0) {
      scheduled = shiftForWorkingDaysAndBlackouts(today, settings);
    }
    return {
      visits: [{ occurrenceDate: occurrence, scheduledDate: scheduled }],
      lastOccurrence: occurrence,
    };
  }

  const until = horizonEnd(today, settings);
  const occurrences = occurrencesFrom(
    agreement.next_due_date,
    agreement.frequency_days,
    until
  );
  if (occurrences.length === 0) {
    return { visits: [], lastOccurrence: null };
  }

  const lastOccurrence = occurrences[occurrences.length - 1]!;
  const visits: PlannedVisit[] = [];
  for (const occurrenceDate of occurrences) {
    if (compareYmd(occurrenceDate, today) < 0) continue;
    visits.push({
      occurrenceDate,
      scheduledDate: placeOnCalendar(
        occurrenceDate,
        agreement.preferred_weekday,
        settings
      ),
    });
  }
  return { visits, lastOccurrence };
}

export function nextDueAfter(lastOccurrence: Ymd, frequencyDays: number): Ymd {
  return addDays(lastOccurrence, frequencyDays);
}

export function firstOccurrenceOnOrAfter(
  cursor: Ymd,
  frequencyDays: number,
  date: Ymd
): Ymd {
  if (frequencyDays < 1) return cursor;
  let current = cursor;
  while (compareYmd(current, date) < 0) {
    current = addDays(current, frequencyDays);
  }
  return current;
}

export function planNextAfterCompletion(params: {
  completedOn: Ymd;
  frequencyDays: number;
  preferredWeekday: number | null;
  settings: RoundsSettings;
  today: Ymd;
}): PlannedVisit {
  const occurrenceDate = addDays(params.completedOn, params.frequencyDays);
  let scheduledDate = placeOnCalendar(
    occurrenceDate,
    params.preferredWeekday,
    params.settings
  );
  if (compareYmd(scheduledDate, params.today) < 0) {
    scheduledDate = shiftForWorkingDaysAndBlackouts(params.today, params.settings);
  }
  return { occurrenceDate, scheduledDate };
}

export function visitReferenceNumber(agreementId: string, occurrenceDate: Ymd): string {
  const prefix = agreementId.replace(/-/g, '').slice(0, 6).toUpperCase();
  const ymd = occurrenceDate.replace(/-/g, '');
  return `R-${prefix}-${ymd}`;
}

export function oneOffReferenceNumber(scheduledDate: Ymd, random4hex: string): string {
  return `R1-${scheduledDate.replace(/-/g, '')}-${random4hex.toLowerCase()}`;
}

export type AgreementForInsert = {
  id: string;
  customer_id: string;
  title: string;
  address: string;
  postcode: string;
  lat: number | null;
  lng: number | null;
  price: number;
  duration_minutes: number;
  preferred_time: string | null;
  access_notes: string | null;
  service_name: string | null;
};

export type VisitInsert = {
  tenant_id: string;
  reference_number: string;
  customer_id: string;
  assigned_worker_id: string | null;
  service_agreement_id: string;
  agreement_occurrence_date: Ymd;
  address: string;
  postcode: string;
  lat: number | null;
  lng: number | null;
  job_description: string;
  status: 'assigned';
  priority: 'normal';
  scheduled_date: Ymd;
  scheduled_time: string | null;
  estimated_duration_minutes: number;
  quoted_amount: number;
  payment_status: 'unpaid';
  customer_confirmation_status: null;
  route_position: null;
  required_skills: [];
  industry_data: Record<string, never>;
  custom_fields: {
    rounds: {
      agreement_id: string;
      service_name: string | null;
      access_notes: string | null;
    };
  };
};

function scheduledTimeFromPreferred(preferredTime: string | null): string | null {
  if (preferredTime == null) return null;
  const trimmed = preferredTime.trim();
  return trimmed === '' ? null : trimmed;
}

export function buildVisitInsert(params: {
  tenantId: string;
  agreement: AgreementForInsert;
  visit: PlannedVisit;
  workerId: string | null;
}): VisitInsert {
  const { tenantId, agreement, visit, workerId } = params;
  return {
    tenant_id: tenantId,
    reference_number: visitReferenceNumber(agreement.id, visit.occurrenceDate),
    customer_id: agreement.customer_id,
    assigned_worker_id: workerId,
    service_agreement_id: agreement.id,
    agreement_occurrence_date: visit.occurrenceDate,
    address: agreement.address,
    postcode: agreement.postcode,
    lat: agreement.lat,
    lng: agreement.lng,
    job_description: agreement.title,
    status: 'assigned',
    priority: 'normal',
    scheduled_date: visit.scheduledDate,
    scheduled_time: scheduledTimeFromPreferred(agreement.preferred_time),
    estimated_duration_minutes: agreement.duration_minutes,
    quoted_amount: agreement.price,
    payment_status: 'unpaid',
    customer_confirmation_status: null,
    route_position: null,
    required_skills: [],
    industry_data: {},
    custom_fields: {
      rounds: {
        agreement_id: agreement.id,
        service_name: agreement.service_name,
        access_notes: agreement.access_notes,
      },
    },
  };
}
