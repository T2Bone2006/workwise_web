import { addDays, compareYmd, isoWeekday, type Ymd } from '@/lib/rounds/dates';

/**
 * Push back (Phase 9, D11): someone is off, so their planned visits slide along their working days, in the same
 * order, into spare days, until the work catches up. Only the listed visits move; each customer's following
 * visit stays on its usual date. Pure: no database, no clock.
 *
 * The owner's example: Dave works Monday to Thursday, Friday is spare, and he is off Monday and Tuesday.
 *   Mon→Wed, Tue→Thu, Wed→Fri (the spare day), Thu→next Mon, then each following day moves one day later
 *   until a spare day lets the work catch up, and the day after that stays where it was.
 */

export type PushBackVisit = {
  id: string;
  date: Ymd;
  position: number | null;
  agreementId: string | null;
  /** The agreement's next visit date that is NOT being moved (its next outstanding visit after this one, else its next due date). */
  nextVisitDate: Ymd | null;
};

export type PushBackInput = {
  /** This person's OPEN visits dated on or after the first day off. */
  visits: PushBackVisit[];
  /** Every day this person is off (all their ranges, expanded). */
  offDays: Ymd[];
  /** ISO weekdays this person usually works (1 = Monday … 7 = Sunday). */
  workingDays: number[];
  /** Business blackout days: never a target. */
  blackouts: Ymd[];
  /** Do not plan past this day (the visit horizon). */
  lastDay: Ymd;
};

export type PushBackPlan = {
  moves: Array<{ id: string; from: Ymd; to: Ymd }>;
  stuck: Array<{ id: string; from: Ymd; reason: 'next_visit' | 'horizon' }>;
};

/** A day a visit may be moved to: not off, not a blackout, and a weekday (Mon–Fri) or one this person works (so weekends are used only by people who work them). */
export function isAllowedTarget(
  day: Ymd,
  input: Pick<PushBackInput, 'offDays' | 'workingDays' | 'blackouts'>,
): boolean {
  if (input.offDays.includes(day) || input.blackouts.includes(day)) return false;
  const weekday = isoWeekday(day);
  return weekday <= 5 || input.workingDays.includes(weekday);
}

/** Search limit: a person cannot be off for more than 120 days (team_days_off check), so a target is always found well inside this. */
const MAX_SEARCH_DAYS = 500;

export function planPushBack(input: PushBackInput): PushBackPlan {
  const offSet = new Set(input.offDays);
  const allowed = (day: Ymd) => isAllowedTarget(day, { ...input, offDays: input.offDays });

  const bundles = new Map<Ymd, PushBackVisit[]>();
  for (const visit of input.visits) {
    const list = bundles.get(visit.date);
    if (list) list.push(visit);
    else bundles.set(visit.date, [visit]);
  }
  const dates = [...bundles.keys()].sort(compareYmd);

  const plan: PushBackPlan = { moves: [], stuck: [] };
  let lastTarget: Ymd | null = null;

  for (const date of dates) {
    const bundle = [...(bundles.get(date) ?? [])].sort((a, b) => {
      const pa = a.position ?? Number.MAX_SAFE_INTEGER;
      const pb = b.position ?? Number.MAX_SAFE_INTEGER;
      return pa !== pb ? pa - pb : a.id.localeCompare(b.id);
    });

    // A bundle must move when it sits on a day off, or when earlier work has been pushed onto or past its day.
    const mustMove = offSet.has(date) || (lastTarget !== null && compareYmd(date, lastTarget) <= 0);
    if (!mustMove) {
      lastTarget = null; // the work has caught up
      continue;
    }

    let target: Ymd = lastTarget !== null && compareYmd(addDays(lastTarget, 1), date) > 0 ? addDays(lastTarget, 1) : date;
    let searched = 0;
    while (!allowed(target) && searched < MAX_SEARCH_DAYS) {
      target = addDays(target, 1);
      searched += 1;
    }
    lastTarget = target;

    for (const visit of bundle) {
      if (compareYmd(target, input.lastDay) > 0 || searched >= MAX_SEARCH_DAYS) {
        plan.stuck.push({ id: visit.id, from: date, reason: 'horizon' });
      } else if (visit.nextVisitDate && compareYmd(target, visit.nextVisitDate) >= 0) {
        plan.stuck.push({ id: visit.id, from: date, reason: 'next_visit' });
      } else {
        plan.moves.push({ id: visit.id, from: date, to: target });
      }
    }
  }
  return plan;
}
