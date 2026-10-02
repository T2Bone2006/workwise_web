import { isoWeekday, type Ymd } from '@/lib/rounds/dates';
import { sliceComingUp, type ComingUp } from '@/lib/rounds/coming-up';

/*
 * "Can I take on another customer, and when?" as one plain statement, worked out
 * from the next 4 weeks of the forward view. No bars, no per-week detail.
 */

export type RoomForWork =
  | { kind: 'empty' }
  | { kind: 'full'; weeks: number }
  | {
      kind: 'room';
      weeks: number;
      /** ISO weekdays (1 = Monday) that are free in most of the weeks, in order. */
      regularWeekdays: number[];
      spareDays: number;
      /** The first few free days, soonest first. */
      nextDays: Ymd[];
    };

const WEEKS = 4;
const NEXT_DAYS = 3;
/** A weekday counts as "regularly free" when it's spare in at least this many of the 4 weeks. */
const REGULAR_IN_WEEKS = 3;

const PLURAL_DAY = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];

export function roomForWork(comingUp: ComingUp): RoomForWork {
  if (comingUp.totalStops === 0) return { kind: 'empty' };
  const view = sliceComingUp(comingUp, WEEKS);
  if (view.totalSpareDays === 0) return { kind: 'full', weeks: view.weeks.length };

  const weeksFreeOn = new Map<number, number>();
  for (const week of view.weeks) {
    for (const weekday of new Set(week.spareDays.map(isoWeekday))) {
      weeksFreeOn.set(weekday, (weeksFreeOn.get(weekday) ?? 0) + 1);
    }
  }
  const regularWeekdays = [...weeksFreeOn.entries()]
    .filter(([, weeks]) => weeks >= REGULAR_IN_WEEKS)
    .map(([weekday]) => weekday)
    .sort((a, b) => a - b);

  return {
    kind: 'room',
    weeks: view.weeks.length,
    regularWeekdays,
    spareDays: view.totalSpareDays,
    nextDays: view.weeks.flatMap((w) => w.spareDays).slice(0, NEXT_DAYS),
  };
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

const shortDay = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

/** The one-sentence answer, e.g. "You could fit another customer in on Tuesdays and Thursdays." */
export function roomHeadline(room: Exclude<RoomForWork, { kind: 'empty' }>): string {
  if (room.kind === 'full') return `You're fully booked for the next ${room.weeks} weeks.`;
  if (room.regularWeekdays.length === 0) return "You've got a few free days coming up.";
  return `You could fit another customer in on ${joinWords(room.regularWeekdays.map((d) => PLURAL_DAY[d - 1]!))}.`;
}

/** The supporting line, e.g. "11 free working days in the next 4 weeks. The soonest are Tue 6 Oct, Thu 8 Oct." */
export function roomDetail(room: Exclude<RoomForWork, { kind: 'empty' }>): string {
  if (room.kind === 'full') return 'Every working day has a stop on it.';
  const count = `${room.spareDays} free working ${room.spareDays === 1 ? 'day' : 'days'} in the next ${room.weeks} weeks.`;
  const days = room.nextDays.map((d) => shortDay.format(new Date(`${d}T12:00:00Z`)).replace(',', ''));
  const lead = days.length === 1 ? 'The soonest is' : 'The soonest are';
  return `${count} ${lead} ${joinWords(days)}.`;
}
