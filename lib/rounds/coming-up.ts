import { addDays, compareYmd, isoWeekday, type Ymd } from '@/lib/rounds/dates';
import { fromPence, toPence } from '@/lib/money/pence';
import { forecastVisitsUntil, type AgreementSchedule } from '@/lib/rounds/recurrence';
import type { RoundsSettings } from '@/lib/rounds/settings';

/*
 * The forward view: for each of the next 4, 8 or 12 weeks, how many stops, how
 * much money and which working days are still free. Pure and read-only.
 * Weeks run Monday to Sunday and week 1 is the current week.
 */

export type ComingUpWeeks = 4 | 8 | 12;

export type ComingUpWeek = {
  weekStart: Ymd;
  weekEnd: Ymd;
  /** 'w/c 6 Oct' */
  label: string;
  stops: number;
  amount: number;
  /** Working days from today on with nothing booked, in order. */
  spareDays: Ymd[];
  /** Working days from today on in this week (not days off), booked or not. 0 = nothing left to plan this week. */
  workingDays: number;
  /** Stops worked out from agreements rather than already booked (a subset of `stops`). */
  forecastStops: number;
  /**
   * Monday to Sunday. `stops` here counts houses (a customer with two visits that day counts once), and a visit
   * already done today or later still counts, so a day that has been worked is never shown as free.
   * `plannable` = a working day still to come (not a day off, a blackout or past).
   */
  days: Array<{ date: Ymd; stops: number; plannable: boolean }>;
};

export type ComingUp = {
  weeks: ComingUpWeek[];
  totalStops: number;
  totalAmount: number;
  totalSpareDays: number;
};

export type BookedStop = {
  scheduledDate: Ymd;
  /** The visit's own price; null falls back to its agreement's price, then 0. */
  amount: number | null;
  agreementId: string | null;
  occurrenceDate: Ymd | null;
  /** Whose visit it is, so several visits at one customer count as one stop on a day. */
  customerId?: string | null;
  /** Already done (only passed for today or later): the day was worked, but it isn't work still coming up. */
  done?: boolean;
};

export type ComingUpAgreement = AgreementSchedule & { price: number; customer_id?: string | null };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The Monday of the week a date is in. */
export function mondayOf(date: Ymd): Ymd {
  return addDays(date, -(isoWeekday(date) - 1));
}

function weekLabel(weekStart: Ymd): string {
  const month = MONTHS[Number(weekStart.slice(5, 7)) - 1];
  return `w/c ${Number(weekStart.slice(8, 10))} ${month}`;
}

export function buildComingUp(p: {
  today: Ymd;
  weeks: ComingUpWeeks;
  settings: RoundsSettings;
  booked: BookedStop[];
  agreements: ComingUpAgreement[];
}): ComingUp {
  const firstMonday = mondayOf(p.today);
  const until = addDays(firstMonday, p.weeks * 7 - 1);
  const working = new Set(p.settings.working_days);
  const blackouts = new Set(p.settings.blackouts);
  const priceOf = new Map(p.agreements.map((a) => [a.id, a.price]));

  const stopsOn = new Map<Ymd, number>();
  const forecastOn = new Map<Ymd, number>();
  const penceOn = new Map<Ymd, number>();
  const housesOn = new Map<Ymd, Set<string>>();
  const add = (map: Map<Ymd, number>, key: Ymd, by: number) => map.set(key, (map.get(key) ?? 0) + by);
  const addHouse = (day: Ymd, key: string) => housesOn.set(day, (housesOn.get(day) ?? new Set()).add(key));

  // Booked visits: a visit with no price of its own counts at its agreement's price.
  const bookedByAgreement = new Map<string, Set<Ymd>>();
  p.booked.forEach((stop, index) => {
    if (compareYmd(stop.scheduledDate, firstMonday) < 0 || compareYmd(stop.scheduledDate, until) > 0) return;
    addHouse(stop.scheduledDate, stop.customerId ? `c:${stop.customerId}` : `job:${index}`);
    if (stop.done) return;
    const price = stop.amount ?? (stop.agreementId ? priceOf.get(stop.agreementId) : undefined) ?? 0;
    add(stopsOn, stop.scheduledDate, 1);
    add(penceOn, stop.scheduledDate, toPence(price));
  });
  for (const stop of p.booked) {
    if (!stop.agreementId || !stop.occurrenceDate) continue;
    const set = bookedByAgreement.get(stop.agreementId) ?? new Set<Ymd>();
    set.add(stop.occurrenceDate);
    bookedByAgreement.set(stop.agreementId, set);
  }

  // What agreements will add beyond what is already booked.
  for (const agreement of p.agreements) {
    const visits = forecastVisitsUntil(
      agreement,
      p.settings,
      p.today,
      until,
      bookedByAgreement.get(agreement.id) ?? new Set(),
    );
    for (const visit of visits) {
      addHouse(visit.scheduledDate, agreement.customer_id ? `c:${agreement.customer_id}` : `a:${agreement.id}`);
      add(stopsOn, visit.scheduledDate, 1);
      add(forecastOn, visit.scheduledDate, 1);
      add(penceOn, visit.scheduledDate, toPence(agreement.price));
    }
  }

  const weeks: ComingUpWeek[] = [];
  for (let i = 0; i < p.weeks; i += 1) {
    const weekStart = addDays(firstMonday, i * 7);
    const weekEnd = addDays(weekStart, 6);
    let stops = 0;
    let forecastStops = 0;
    let pence = 0;
    const spareDays: Ymd[] = [];
    const days: ComingUpWeek['days'] = [];
    let workingDays = 0;
    for (let d = 0; d < 7; d += 1) {
      const day = addDays(weekStart, d);
      const count = stopsOn.get(day) ?? 0;
      const houses = housesOn.get(day)?.size ?? 0;
      stops += count;
      forecastStops += forecastOn.get(day) ?? 0;
      pence += penceOn.get(day) ?? 0;
      const plannable = compareYmd(day, p.today) >= 0 && working.has(isoWeekday(day)) && !blackouts.has(day);
      if (plannable) workingDays += 1;
      if (plannable && houses === 0) spareDays.push(day);
      days.push({ date: day, stops: houses, plannable });
    }
    weeks.push({ weekStart, weekEnd, label: weekLabel(weekStart), stops, amount: fromPence(pence), spareDays, workingDays, forecastStops, days });
  }

  return {
    weeks,
    totalStops: weeks.reduce((s, w) => s + w.stops, 0),
    totalAmount: fromPence(weeks.reduce((s, w) => s + toPence(w.amount), 0)),
    totalSpareDays: weeks.reduce((s, w) => s + w.spareDays.length, 0),
  };
}

/** The same view for fewer weeks, from one 12-week calculation. */
export function sliceComingUp(full: ComingUp, weeks: ComingUpWeeks): ComingUp {
  const kept = full.weeks.slice(0, weeks);
  return {
    weeks: kept,
    totalStops: kept.reduce((s, w) => s + w.stops, 0),
    totalAmount: fromPence(kept.reduce((s, w) => s + toPence(w.amount), 0)),
    totalSpareDays: kept.reduce((s, w) => s + w.spareDays.length, 0),
  };
}
