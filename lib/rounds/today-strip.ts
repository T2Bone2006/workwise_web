import { groupHouseStops } from '@/lib/rounds/house-stops';
import { RESCHEDULE_STATUSES } from '@/lib/rounds/visit-statuses';
import { fromPence, toPence } from '@/lib/money/pence';

export type RoundVisit = {
  id: string;
  customer_id: string | null;
  customer_name: string | null;
  address: string;
  postcode: string;
  status: string;
  scheduled_time: string | null;
  job_description?: string | null;
  quoted_amount?: number | null;
  final_amount?: number | null;
};

export type StopPreview = {
  customerName: string | null;
  /** First line of the address, e.g. "12 Elm Road". */
  street: string;
  time: string | null;
  /** What's being done, all visits at the house joined ("Window clean (front), Conservatory roof"). */
  work: string;
  amount: number;
};

export type TodayRound = {
  /** Houses today, several visits at one house counting once, skipped ones left out. */
  stops: number;
  /** Houses where every visit is done. */
  done: number;
  /** Houses where every visit was skipped. */
  skipped: number;
  toGo: number;
  /** £ for every visit not skipped. */
  plannedAmount: number;
  /** £ for the visits done so far (final price when one was set). */
  doneAmount: number;
  /** The first house still to do, in route order. */
  next: StopPreview | null;
  /** The houses after that, up to 3. */
  upNext: StopPreview[];
};

const LEFTOVER = new Set<string>(RESCHEDULE_STATUSES);
const UP_NEXT = 3;

/** '14:10:00' → '2:10pm'; anything that isn't a time → null. */
export function friendlyTime(value: string | null): string | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value ?? '');
  if (!match) return null;
  const hours = Number(match[1]);
  if (hours > 23) return null;
  const suffix = hours >= 12 ? 'pm' : 'am';
  return `${hours % 12 === 0 ? 12 : hours % 12}:${match[2]}${suffix}`;
}

const price = (v: RoundVisit) => toPence(v.status === 'completed' ? (v.final_amount ?? v.quoted_amount ?? 0) : (v.quoted_amount ?? 0));

function preview(group: RoundVisit[]): StopPreview {
  const todo = group.filter((v) => LEFTOVER.has(v.status));
  const first = todo[0] ?? group[0]!;
  return {
    customerName: first.customer_name,
    street: first.address.split(',')[0]?.trim() || first.address,
    time: friendlyTime(first.scheduled_time),
    work: [...new Set(todo.map((v) => v.job_description?.trim()).filter(Boolean))].join(', '),
    amount: fromPence(todo.reduce((sum, v) => sum + price(v), 0)),
  };
}

/** Visits arrive in route order; "next" is the first house with a visit still to do. */
export function summariseToday(visits: RoundVisit[]): TodayRound {
  const houses = groupHouseStops(visits);
  const skipped = houses.filter((g) => g.every((v) => v.status === 'cancelled')).length;
  const stops = houses.map((g) => g.filter((v) => v.status !== 'cancelled')).filter((g) => g.length > 0);
  const done = stops.filter((g) => g.every((v) => v.status === 'completed')).length;
  const todo = stops.filter((g) => g.some((v) => LEFTOVER.has(v.status)));
  const live = visits.filter((v) => v.status !== 'cancelled');

  return {
    stops: stops.length,
    done,
    skipped,
    toGo: todo.length,
    plannedAmount: fromPence(live.reduce((sum, v) => sum + price(v), 0)),
    doneAmount: fromPence(live.filter((v) => v.status === 'completed').reduce((sum, v) => sum + price(v), 0)),
    next: todo[0] ? preview(todo[0]) : null,
    upNext: todo.slice(1, 1 + UP_NEXT).map(preview),
  };
}

export type StopState = 'done' | 'skipped' | 'next' | 'todo';

export type StopRow = StopPreview & { state: StopState };

/**
 * Every house on today's round in route order, each with where it stands:
 * done, skipped, the next one to do, or still to do. Same grouping and
 * sums as summariseToday, so the list and the totals always agree.
 */
export function listTodayStops(visits: RoundVisit[]): StopRow[] {
  let nextTaken = false;
  return groupHouseStops(visits).map((group) => {
    const live = group.filter((v) => v.status !== 'cancelled');
    const shown = live.length > 0 ? live : group;
    const first = group[0]!;
    const row: StopPreview = {
      customerName: first.customer_name,
      street: first.address.split(',')[0]?.trim() || first.address,
      time: friendlyTime(first.scheduled_time),
      work: [...new Set(shown.map((v) => v.job_description?.trim()).filter(Boolean))].join(', '),
      amount: fromPence(shown.reduce((sum, v) => sum + price(v), 0)),
    };
    if (live.length === 0) return { ...row, state: 'skipped' as const };
    if (live.every((v) => v.status === 'completed')) return { ...row, state: 'done' as const };
    if (live.some((v) => LEFTOVER.has(v.status)) && !nextTaken) {
      nextTaken = true;
      return { ...row, state: 'next' as const };
    }
    return { ...row, state: 'todo' as const };
  });
}
