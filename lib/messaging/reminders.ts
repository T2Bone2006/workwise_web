import { isUkMobileE164 } from '@/lib/messaging/phone';
import { groupHouseStops } from '@/lib/rounds/house-stops';
import { addDays } from '@/lib/rounds/dates';
import { visitServiceTitle } from '@/lib/rounds/visit-title';

export type ReminderVisit = {
  id: string;
  customer_id: string | null;
  service_agreement_id: string | null;
  status: string;
  scheduled_date: string; // Ymd
  scheduled_time: string | null; // 'HH:MM' or 'HH:MM:SS'
  address: string;
  postcode: string;
  route_position: number | null;
  custom_fields: unknown;
  job_description: string | null;
  agreement_reminder_enabled: boolean; // service_agreements.reminder_enabled (true if missing)
};

export type ReminderCustomer = {
  id: string;
  is_active: boolean;
  visit_reminders: boolean;
  preferred_channel: string | null;
  phone_e164: string | null;
};

export type ReminderPlan = {
  customerId: string;
  date: string; // the visit date
  jobIds: string[]; // sorted ascending
  dedupeKey: string; // `reminder:<date>:<jobIds[0]>`
  address: string; // the stop's address (first visit's)
  services: string[]; // visitServiceTitle per visit, route order, de-duplicated
  time: string | null; // earliest scheduled_time on the stop, 'HH:MM'
};

/** The date reminders are sent for today: today + days (London). */
export function reminderTargetDate(today: string, daysBefore: number): string {
  return addDays(today, daysBefore);
}

function compareNullsLast(
  a: number | null,
  b: number | null,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

function compareTime(a: string | null, b: string | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a.localeCompare(b);
}

function toHhMm(value: string): string {
  return value.length >= 5 ? value.slice(0, 5) : value;
}

function earliestTime(times: Array<string | null>): string | null {
  let best: string | null = null;
  for (const raw of times) {
    if (raw == null || raw.trim() === '') continue;
    const hhmm = toHhMm(raw.trim());
    if (best == null || hhmm < best) best = hhmm;
  }
  return best;
}

export function planReminders(p: {
  visits: ReminderVisit[]; // all of the business's visits on the target date
  customers: Map<string, ReminderCustomer>;
  remindersEnabled: boolean; // settings.messaging.reminders_enabled
  toldAboutJobIds: Set<string>; // job ids with a visit_change text/email sent in the last 14 days
}): ReminderPlan[] {
  if (!p.remindersEnabled) return [];

  const eligible = p.visits.filter((visit) => {
    if (visit.status !== 'assigned') return false;
    if (visit.service_agreement_id == null) return false;
    if (visit.customer_id == null) return false;
    if (!visit.agreement_reminder_enabled) return false;

    const customer = p.customers.get(visit.customer_id);
    if (!customer) return false;
    if (!customer.is_active) return false;
    if (!customer.visit_reminders) return false;
    if (customer.preferred_channel === 'none') return false;
    if (!isUkMobileE164(customer.phone_e164)) return false;
    return true;
  });

  const sorted = [...eligible].sort((a, b) => {
    const byRoute = compareNullsLast(a.route_position, b.route_position);
    if (byRoute !== 0) return byRoute;
    return compareTime(a.scheduled_time, b.scheduled_time);
  });

  const stops = groupHouseStops(sorted);
  const plans: ReminderPlan[] = [];

  for (const stop of stops) {
    if (stop.some((visit) => p.toldAboutJobIds.has(visit.id))) continue;

    const first = stop[0]!;
    const customerId = first.customer_id!;
    const jobIds = stop.map((visit) => visit.id).sort();
    const services: string[] = [];
    for (const visit of stop) {
      const title = visitServiceTitle(visit);
      if (!services.includes(title)) services.push(title);
    }

    plans.push({
      customerId,
      date: first.scheduled_date,
      jobIds,
      dedupeKey: `reminder:${first.scheduled_date}:${jobIds[0]}`,
      address: first.address,
      services,
      time: earliestTime(stop.map((visit) => visit.scheduled_time)),
    });
  }

  return plans;
}
