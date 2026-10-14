import type { Ymd } from '@/lib/rounds/dates';
import type { DayOff, TeamPerson } from '@/lib/team/types';

export type TeamTodayPerson = {
  workerId: string | null;
  name: string;
  isOwner: boolean;
  stops: number;
  done: number;
  skipped: number;
  /** Cash and cheques they recorded today, in pounds. Not tracked for the owner. */
  takenToday: number;
  /** All the cash they are holding, in pounds. */
  holding: number;
  startedToday: boolean;
  helpersToday: string[];
  /** Has stops, has not pressed Start day, and it is past 09:00 London. Never the owner. */
  showNotStarted: boolean;
  /** Off today but still has stops: the owner needs to fix it. */
  stopsOnDayOff: boolean;
  /** A removed lead who still holds cash. */
  left: boolean;
};

export type TeamToday = {
  /** Anyone whose days off cover today; until = their last day off. */
  out: Array<{ name: string; until: Ymd }>;
  people: TeamTodayPerson[];
  weekDays: Array<{ name: string; days: number; earned: number }>;
  holdingTotal: number;
};

export type TeamTodayInput = {
  today: Ymd;
  /** The hour in London, 0 to 23. */
  hour: number;
  people: TeamPerson[];
  owner: { workerId: string; name: string } | null;
  daysOff: DayOff[];
  jobs: Array<{ workerId: string; status: string }>;
  takenByWorker: ReadonlyMap<string, number>;
  held: Array<{ workerId: string | null; name: string; total: number }>;
  /** team_people ids with a days-worked row today, and the helpers' rows with who they went out with. */
  workedPersonIds: ReadonlySet<string>;
  helperRows: Array<{ helperName: string; withPersonId: string | null }>;
  weekDays: TeamToday['weekDays'];
};

const START_HOUR = 9;

/** Pure. Null when there is nothing to show: no team and no held cash. */
export function shapeTeamToday(input: TeamTodayInput): TeamToday | null {
  const active = input.people.filter((p) => !p.endedAt);
  const holdingTotal = Math.round(input.held.reduce((sum, g) => sum + g.total, 0) * 100) / 100;
  if (active.length === 0 && input.held.length === 0) return null;

  const stopsFor = (workerId: string) => {
    let stops = 0;
    let done = 0;
    let skipped = 0;
    for (const j of input.jobs) {
      if (j.workerId !== workerId) continue;
      if (j.status === 'cancelled') skipped += 1;
      else {
        stops += 1;
        if (j.status === 'completed') done += 1;
      }
    }
    return { stops, done, skipped };
  };
  const holdingFor = (workerId: string | null) => input.held.find((g) => g.workerId === workerId)?.total ?? 0;
  const offToday = (workerId: string) => input.daysOff.filter((d) => d.workerId === workerId && d.from <= input.today && input.today <= d.to);

  const out: TeamToday['out'] = [];
  const people: TeamTodayPerson[] = [];

  if (input.owner) {
    const s = stopsFor(input.owner.workerId);
    const off = offToday(input.owner.workerId);
    if (off.length > 0) out.push({ name: 'You', until: off.map((d) => d.to).sort().pop()! });
    if (s.stops > 0 || off.length === 0) {
      people.push({
        workerId: input.owner.workerId,
        name: 'You',
        isOwner: true,
        ...s,
        takenToday: 0,
        holding: 0,
        startedToday: false,
        helpersToday: [],
        showNotStarted: false,
        stopsOnDayOff: off.length > 0 && s.stops > 0,
        left: false,
      });
    }
  }

  for (const lead of active.filter((p) => p.kind === 'lead' && p.workerId && p.inviteStatus !== 'pending')) {
    const workerId = lead.workerId!;
    const s = stopsFor(workerId);
    const off = offToday(workerId);
    if (off.length > 0) out.push({ name: lead.name, until: off.map((d) => d.to).sort().pop()! });
    if (off.length > 0 && s.stops === 0) continue;
    const started = input.workedPersonIds.has(lead.id);
    people.push({
      workerId,
      name: lead.name,
      isOwner: false,
      ...s,
      takenToday: input.takenByWorker.get(workerId) ?? 0,
      holding: holdingFor(workerId),
      startedToday: started,
      helpersToday: input.helperRows.filter((h) => h.withPersonId === lead.id).map((h) => h.helperName),
      showNotStarted: s.stops > 0 && !started && input.hour >= START_HOUR,
      stopsOnDayOff: off.length > 0 && s.stops > 0,
      left: false,
    });
  }

  // Cash still held by someone no longer on the team (or by a name only): it must stay visible.
  const shown = new Set(people.map((p) => p.workerId).filter((id): id is string => Boolean(id)));
  for (const group of input.held) {
    if (group.workerId && shown.has(group.workerId)) continue;
    people.push({
      workerId: group.workerId,
      name: group.name,
      isOwner: false,
      stops: 0,
      done: 0,
      skipped: 0,
      takenToday: group.workerId ? (input.takenByWorker.get(group.workerId) ?? 0) : 0,
      holding: group.total,
      startedToday: false,
      helpersToday: [],
      showNotStarted: false,
      stopsOnDayOff: false,
      left: true,
    });
  }

  return { out, people, weekDays: input.weekDays, holdingTotal };
}
