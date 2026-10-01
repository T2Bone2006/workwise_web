import { addDays, isoWeekday, type Ymd } from '@/lib/rounds/dates';
import { groupHouseStops, houseKey } from '@/lib/rounds/house-stops';
import { RESCHEDULE_STATUSES } from '@/lib/rounds/visit-statuses';
import type { VisitRow } from '@/lib/data/rounds/visits';
import type { UntoldMove } from '@/lib/rounds/visit-changes';

// Pure helpers for the Week board on the dashboard (no React, no Supabase). They give the
// same answers as the phone's `workwise-mobile/src/lib/rounds/weekBoard.ts`, so both
// boards behave alike. All day arithmetic is on Ymd strings, so a clock change never
// loses or repeats a day.

/** One job inside a stop (a house with two services on a day is one card holding two of these). */
export type BoardJob = {
  id: string;
  /** What the job is ("Window clean"). */
  services: string;
  amount: number;
  state: 'planned' | 'underway' | 'done' | 'skipped';
  /** Still open, so it can be moved on its own, even when its sibling at the house is done. */
  movable: boolean;
  paid: 'paid' | 'part' | 'unpaid' | null;
  untoldChangeId: string | null;
};

export type BoardStop = {
  /** First visit id in route order. */
  id: string;
  /** Every visit of the stop (for the side panel). */
  visits: VisitRow[];
  jobIds: string[];
  /** Customer name, else the first line of the address, else "Stop". */
  name: string;
  street: string;
  postcode: string;
  /** job_description joined ", " */
  services: string;
  /** Sum of final_amount ?? quoted_amount, cancelled excluded. */
  amount: number;
  /** Earliest scheduled_time as "HH:MM". */
  time: string | null;
  /** null until something at this stop is done. */
  paid: 'paid' | 'part' | 'unpaid' | null;
  state: 'planned' | 'underway' | 'done' | 'skipped' | 'part_done';
  /** True only if every visit at the stop is still open. Moving half a house is not a board action. */
  movable: boolean;
  /** 'Said no' | 'Asked to move' | 'Asked for Thu 8 Oct' | 'Sent a message' */
  reply: string | null;
  /** The move that put it here, if customers haven't been told. Drives the "Not told" tag. */
  untoldChangeId: string | null;
  /** Same customer + address = same house. Two stops of one house on a day are one card. */
  house: string;
  /** How many jobs the card holds (2+ = a combined visit). */
  jobCount: number;
  /** Each job on its own, so one can be moved without the others. */
  jobs: BoardJob[];
};

export type BoardDay = {
  date: Ymd;
  /** 1 Mon … 7 Sun */
  weekday: number;
  /** Route order, skipped last. */
  stops: BoardStop[];
  /** Stops that are not skipped ("3 of 5 done"). */
  total: number;
  /** Stops that are done. */
  done: number;
  plannedAmount: number;
  isToday: boolean;
  isPast: boolean;
  /** Not a working day, or a blackout day. A day off still lists its stops. */
  isDayOff: boolean;
};

export type BoardWeek = {
  weekStart: Ymd;
  /** "w/c 5 Oct" */
  label: string;
  days: BoardDay[];
  stops: number;
  amount: number;
};

export type BoardRange = { from: Ymd; weeks: number };

export const BOARD_START_WEEKS_BACK = 2;
/** 2 back + this week + 3 ahead */
export const BOARD_START_WEEKS = 6;
export const BOARD_LOAD_STEP_WEEKS = 2;
export const BOARD_MAX_WEEKS = 16;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const HIDDEN_STATUSES = new Set(['pending_send', 'declined']);
const OPEN_STATUSES = new Set<string>(RESCHEDULE_STATUSES);
const UNDERWAY_STATUSES = new Set(['en_route', 'arrived', 'in_progress', 'paused']);

function parts(ymd: Ymd): { year: number; month: number; day: number } {
  const [y, m, d] = ymd.split('-').map(Number);
  return { year: y ?? 1970, month: m ?? 1, day: d ?? 1 };
}

/** "Thu 8 Oct" (fixed abbreviations, no timezone shift). */
export function formatBoardDay(ymd: Ymd): string {
  const { year, month, day } = parts(ymd);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${weekday} ${day} ${MONTHS[month - 1]}`;
}

export function mondayOf(date: Ymd): Ymd {
  return addDays(date, 1 - isoWeekday(date));
}

function weekLabel(weekStart: Ymd): string {
  const { month, day } = parts(weekStart);
  return `w/c ${day} ${MONTHS[month - 1]}`;
}

/** Two weeks back and three ahead, counting this week. */
export function initialRange(today: Ymd): BoardRange {
  return {
    from: addDays(mondayOf(today), -7 * BOARD_START_WEEKS_BACK),
    weeks: BOARD_START_WEEKS,
  };
}

/** The last Sunday the range covers. */
export function rangeEnd(range: BoardRange): Ymd {
  return addDays(mondayOf(range.from), range.weeks * 7 - 1);
}

/** Two more weeks that way, never more than 16 in total (the far end is dropped). */
export function extendRange(range: BoardRange, dir: 'earlier' | 'later'): BoardRange {
  const step = BOARD_LOAD_STEP_WEEKS;
  if (dir === 'earlier') {
    return {
      from: addDays(range.from, -7 * step),
      weeks: Math.min(range.weeks + step, BOARD_MAX_WEEKS),
    };
  }
  const weeks = range.weeks + step;
  if (weeks <= BOARD_MAX_WEEKS) return { from: range.from, weeks };
  return { from: addDays(range.from, (weeks - BOARD_MAX_WEEKS) * 7), weeks: BOARD_MAX_WEEKS };
}

function firstLine(address: string): string {
  return address.split(/[\n,]/)[0]?.trim() ?? '';
}

function replyText(visit: VisitRow): string | null {
  switch (visit.customer_confirmation_status) {
    case 'declined':
      return 'Said no';
    case 'rescheduled':
      return visit.customer_requested_date
        ? `Asked for ${formatBoardDay(visit.customer_requested_date.slice(0, 10))}`
        : 'Asked to move';
    case 'replied':
      return 'Sent a message';
    default:
      return null;
  }
}

function compareVisits(a: VisitRow, b: VisitRow): number {
  const ap = a.route_position;
  const bp = b.route_position;
  if (ap != null && bp != null && ap !== bp) return ap - bp;
  if (ap != null && bp == null) return -1;
  if (ap == null && bp != null) return 1;
  const at = a.scheduled_time ?? '';
  const bt = b.scheduled_time ?? '';
  if (at !== bt) return at < bt ? -1 : 1;
  return 0; // equal: keep the order the query gave
}

function paidOf(visits: VisitRow[]): BoardStop['paid'] {
  const done = visits.filter((visit) => visit.status === 'completed');
  if (done.length === 0) return null;
  const states = done.map((visit) => visit.payment_status ?? 'unpaid');
  if (states.every((state) => state === 'paid' || state === 'waived')) return 'paid';
  if (states.every((state) => state === 'unpaid' || state === 'invoiced')) return 'unpaid';
  return 'part';
}

function stateOf(visits: VisitRow[]): BoardStop['state'] {
  const statuses = visits.map((visit) => visit.status);
  if (statuses.every((status) => status === 'cancelled')) return 'skipped';
  const open = statuses.filter((status) => OPEN_STATUSES.has(status));
  if (open.length === 0) return 'done';
  if (statuses.some((status) => status === 'completed')) return 'part_done';
  if (open.some((status) => UNDERWAY_STATUSES.has(status))) return 'underway';
  return 'planned';
}

function boardJob(visit: VisitRow, untold?: Map<string, string>): BoardJob {
  const state: BoardJob['state'] =
    visit.status === 'cancelled'
      ? 'skipped'
      : visit.status === 'completed'
        ? 'done'
        : UNDERWAY_STATUSES.has(visit.status)
          ? 'underway'
          : 'planned';
  return {
    id: visit.id,
    services: visit.job_description.trim() || 'Visit',
    amount: visit.status === 'cancelled' ? 0 : (visit.final_amount ?? visit.quoted_amount ?? 0),
    state,
    movable: OPEN_STATUSES.has(visit.status),
    paid: visit.status === 'completed' ? paidOf([visit]) : null,
    untoldChangeId: untold?.get(visit.id) ?? null,
  };
}

function boardStop(visits: VisitRow[], untold?: Map<string, string>): BoardStop {
  const first = visits[0]!;
  const named = visits.find((visit) => visit.customer_name?.trim());
  let amount = 0;
  let time: string | null = null;
  for (const visit of visits) {
    if (visit.status !== 'cancelled') amount += visit.final_amount ?? visit.quoted_amount ?? 0;
    const t = visit.scheduled_time?.slice(0, 5) ?? null;
    if (t && (time === null || t < time)) time = t;
  }
  const street = firstLine(first.address);
  return {
    id: first.id,
    visits,
    jobIds: visits.map((visit) => visit.id),
    name: named?.customer_name?.trim() || street || 'Stop',
    street,
    postcode: first.postcode,
    services: visits
      .map((visit) => visit.job_description.trim())
      .filter(Boolean)
      .join(', '),
    amount,
    time,
    paid: paidOf(visits),
    state: stateOf(visits),
    movable: visits.every((visit) => OPEN_STATUSES.has(visit.status)),
    reply: visits.map(replyText).find((text) => text != null) ?? null,
    untoldChangeId: visits.map((visit) => untold?.get(visit.id)).find((id) => id != null) ?? null,
    house: houseKey(first),
    jobCount: visits.length,
    jobs: visits.map((visit) => boardJob(visit, untold)),
  };
}

/** `from` is snapped back to its Monday. */
export function buildWeeks(p: {
  visits: VisitRow[];
  from: Ymd;
  weeks: number;
  today: Ymd;
  workingDays: number[];
  blackouts: string[];
  /** visit id → the move customers haven't been told about (see `untoldByJob`). */
  untold?: Map<string, string>;
}): BoardWeek[] {
  const working = new Set(p.workingDays);
  const off = new Set(p.blackouts);
  const byDate = new Map<Ymd, VisitRow[]>();
  for (const visit of p.visits) {
    if (!visit.scheduled_date || HIDDEN_STATUSES.has(visit.status)) continue;
    const list = byDate.get(visit.scheduled_date);
    if (list) list.push(visit);
    else byDate.set(visit.scheduled_date, [visit]);
  }

  const start = mondayOf(p.from);
  const weeks: BoardWeek[] = [];
  for (let w = 0; w < p.weeks; w += 1) {
    const weekStart = addDays(start, w * 7);
    const days: BoardDay[] = [];
    let stopCount = 0;
    let amount = 0;
    for (let d = 0; d < 7; d += 1) {
      const date = addDays(weekStart, d);
      const forDay = byDate.get(date) ?? [];
      const active = forDay.filter((visit) => visit.status !== 'cancelled').sort(compareVisits);
      const skipped = forDay.filter((visit) => visit.status === 'cancelled').sort(compareVisits);
      const stops = groupHouseStops([...active, ...skipped]).map((group) => boardStop(group, p.untold));
      const counted = stops.filter((stop) => stop.state !== 'skipped');
      const plannedAmount = stops.reduce((sum, stop) => sum + stop.amount, 0);
      const weekday = isoWeekday(date);
      days.push({
        date,
        weekday,
        stops,
        total: counted.length,
        done: stops.filter((stop) => stop.state === 'done').length,
        plannedAmount,
        isToday: date === p.today,
        isPast: date < p.today,
        isDayOff: !working.has(weekday) || off.has(date),
      });
      stopCount += counted.length;
      amount += plannedAmount;
    }
    weeks.push({ weekStart, label: weekLabel(weekStart), days, stops: stopCount, amount });
  }
  return weeks;
}

/** Where a card dropped at position `pos` lands: how many card midpoints are before it (0 … length). */
export function dropIndex(cardMidpoints: number[], pos: number): number {
  let index = 0;
  for (const mid of cardMidpoints) if (mid < pos) index += 1;
  return index;
}

/**
 * One job of a combined card, as a stop of its own, so it can be moved on its own. It keeps the
 * house, so it joins an existing visit of the same house on the day it lands on.
 */
export function jobAsStop(stop: BoardStop, jobId: string): BoardStop | null {
  const job = stop.jobs.find((j) => j.id === jobId);
  const visit = stop.visits.find((v) => v.id === jobId);
  if (!job || !visit) return null;
  return {
    ...stop,
    id: job.id,
    visits: [visit],
    jobIds: [job.id],
    name: `${stop.name} · ${job.services}`,
    services: job.services,
    amount: job.amount,
    state: job.state === 'underway' ? 'underway' : job.state,
    movable: job.movable,
    paid: job.paid,
    untoldChangeId: job.untoldChangeId,
    jobCount: 1,
    jobs: [job],
  };
}

/** The stop on `day` that is the same house as `stop`, if there is one (dropping would join them). Skipped stops don't count. */
export function findHouseMatch(day: BoardDay, stop: BoardStop): BoardStop | null {
  return (
    day.stops.find((other) => other.id !== stop.id && other.house === stop.house && other.state !== 'skipped') ??
    null
  );
}

/**
 * Every visit id for `target.date` in the new order. `index` counts the target's stops with
 * the dragged stop taken out (so dropping a stop at its own place changes nothing). Skipped
 * stops stay last. With `mergeInto`, the dragged visits go right after that stop's own so
 * the card stays one.
 */
export function orderAfterDrop(p: {
  target: BoardDay;
  dragged: BoardStop;
  index: number;
  mergeInto?: BoardStop;
}): string[] {
  const others = p.target.stops.filter((stop) => stop.id !== p.dragged.id);
  if (p.mergeInto) {
    const into = p.mergeInto;
    return others.flatMap((stop) =>
      stop.id === into.id ? [...stop.jobIds, ...p.dragged.jobIds] : stop.jobIds,
    );
  }
  const active = others.filter((stop) => stop.state !== 'skipped');
  const skipped = others.filter((stop) => stop.state === 'skipped');
  const at = Math.max(0, Math.min(p.index, active.length));
  const ordered = [...active.slice(0, at), p.dragged, ...active.slice(at), ...skipped];
  return ordered.flatMap((stop) => stop.jobIds);
}

/** Past days are not drop targets. */
export function canDropOn(day: BoardDay): boolean {
  return !day.isPast;
}

function movableCount(day: BoardDay): number {
  return day.stops.filter((stop) => stop.movable).length;
}

/** Two different days, neither past, at least one with a stop that can move. */
export function canSwap(a: BoardDay, b: BoardDay): boolean {
  if (a.date === b.date || a.isPast || b.isPast) return false;
  return movableCount(a) > 0 || movableCount(b) > 0;
}

/** "Swap Tue 6 Oct (6 stops) with Thu 8 Oct (3 stops)?" Counts the stops that will move. */
export function swapSummary(a: BoardDay, b: BoardDay): string {
  const count = (day: BoardDay) => {
    const n = movableCount(day);
    return `${n} ${n === 1 ? 'stop' : 'stops'}`;
  };
  return `Swap ${formatBoardDay(a.date)} (${count(a)}) with ${formatBoardDay(b.date)} (${count(b)})?`;
}

/**
 * The visits as they will look once a drop is saved, so the card stays where it was dropped
 * while the server answers. `jobIds` change day; every id in `orderedJobIds` gets its new
 * 1-based position.
 */
export function applyLocalMove(
  visits: VisitRow[],
  p: { jobIds: string[]; toDate: Ymd; orderedJobIds: string[] },
): VisitRow[] {
  const moving = new Set(p.jobIds);
  const position = new Map(p.orderedJobIds.map((id, index) => [id, index + 1] as const));
  return visits.map((visit) => {
    const isMoving = moving.has(visit.id);
    const newPosition = position.get(visit.id);
    if (!isMoving && newPosition === undefined) return visit;
    return {
      ...visit,
      scheduled_date: isMoving ? p.toDate : visit.scheduled_date,
      route_position: newPosition ?? visit.route_position,
    };
  });
}

/**
 * Which visits to tag "Not told": a visit in an untold move that is still where the move
 * left it (a swap sends each visit to the other day), still open, and not in the past.
 */
export function untoldByJob(
  moves: UntoldMove[],
  visits: VisitRow[],
  today: Ymd,
): Map<string, string> {
  const byId = new Map(visits.map((visit) => [visit.id, visit]));
  const tagged = new Map<string, string>();
  for (const move of moves) {
    for (const entry of move.jobs) {
      const visit = byId.get(entry.jobId);
      if (!visit || !visit.scheduled_date || tagged.has(visit.id)) continue;
      if (!OPEN_STATUSES.has(visit.status)) continue;
      const expected =
        move.kind === 'swap_days'
          ? entry.fromDate === move.fromDate
            ? move.toDate
            : move.fromDate
          : move.toDate;
      if (expected && visit.scheduled_date === expected && expected >= today) {
        tagged.set(visit.id, move.changeId);
      }
    }
  }
  return tagged;
}
