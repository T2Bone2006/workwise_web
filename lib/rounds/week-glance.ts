import { addDays, compareYmd, isoWeekday, type Ymd } from '@/lib/rounds/dates';
import { summariseToday, type RoundVisit } from '@/lib/rounds/today-strip';

export type GlanceDay = {
  date: Ymd;
  stops: number;
  done: number;
  amount: number;
  isToday: boolean;
  isPast: boolean;
  /** Not a working day, or a day off the business blocked out. */
  isDayOff: boolean;
  /** A working day from today on with nothing booked. */
  isFree: boolean;
};

export type WeekGlance = {
  days: GlanceDay[];
  stops: number;
  amount: number;
  /** £ for visits already done this week. */
  doneAmount: number;
  freeDays: number;
};

/** Monday to Sunday of the week `monday` starts, from that week's visits. */
export function summariseWeek(p: {
  monday: Ymd;
  today: Ymd;
  visits: Array<RoundVisit & { scheduled_date: Ymd | null }>;
  workingDays: number[];
  blackouts: Ymd[];
}): WeekGlance {
  const working = new Set(p.workingDays);
  const blackouts = new Set(p.blackouts);
  const days: GlanceDay[] = [];
  let doneAmount = 0;

  for (let i = 0; i < 7; i += 1) {
    const date = addDays(p.monday, i);
    const day = summariseToday(p.visits.filter((v) => v.scheduled_date?.slice(0, 10) === date));
    const isPast = compareYmd(date, p.today) < 0;
    const isDayOff = !working.has(isoWeekday(date)) || blackouts.has(date);
    doneAmount += day.doneAmount;
    days.push({
      date,
      stops: day.stops,
      done: day.done,
      amount: day.plannedAmount,
      isToday: date === p.today,
      isPast,
      isDayOff,
      isFree: !isPast && !isDayOff && day.stops === 0,
    });
  }

  return {
    days,
    stops: days.reduce((sum, d) => sum + d.stops, 0),
    amount: Math.round(days.reduce((sum, d) => sum + d.amount, 0) * 100) / 100,
    doneAmount: Math.round(doneAmount * 100) / 100,
    freeDays: days.filter((d) => d.isFree).length,
  };
}
