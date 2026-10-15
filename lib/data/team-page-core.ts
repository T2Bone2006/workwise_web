import type { Ymd } from '@/lib/rounds/dates';
import type { LanePerson } from '@/lib/rounds/lanes';
import type { DayOff, TeamPerson } from '@/lib/team/types';

/** What the Team page shows for each person today. Follows days off and today's visits, not the usual days. */
export type TeamToday = 'working' | 'off' | 'not_started' | 'no_stops';

export type TeamPagePerson = TeamPerson & {
  today: TeamToday;
  stopsToday: number;
  doneToday: number;
  usualRounds: Array<{ id: string; name: string; colour: string }>;
  heldCashPence: number;
  /** Today and later only. */
  daysOff: Array<{ id: string; from: Ymd; to: Ymd; note: string | null }>;
};

export type TeamPageRound = { id: string; name: string; colour: string; usualLeadWorkerId: string | null };

export type TeamPageBilling = {
  canAddLeads: boolean;
  reason: string | null;
  perLeadPence: number;
  interval: 'month' | 'year' | null;
  leadCount: number;
};

export type TeamPageData = {
  people: TeamPagePerson[];
  rounds: TeamPageRound[];
  billing: TeamPageBilling;
  heldTotalPence: number;
  /** The owner and each lead who can take visits (for giving a round, and who can be marked off). */
  assignees: LanePerson[];
  /** Everyone's upcoming days off, so the dialogs can tell who is off on a day. */
  daysOffAll: DayOff[];
};

export type TeamPageInput = {
  people: TeamPerson[];
  daysOff: DayOff[];
  rounds: TeamPageRound[];
  /** Today's visits per worker (workers.id). */
  stops: ReadonlyMap<string, { total: number; done: number }>;
  /** team_people ids with a days-worked row for today. */
  workedToday: ReadonlySet<string>;
  /** Cash each worker is holding, in pence, by workers.id. */
  heldByWorker: ReadonlyMap<string, number>;
  today: Ymd;
};

function isOff(daysOff: ReadonlyArray<{ from: Ymd; to: Ymd }>, today: Ymd): boolean {
  return daysOff.some((d) => d.from <= today && today <= d.to);
}

/** Pure. One entry per person with everything the cards need; never throws. */
export function shapePeople(input: TeamPageInput): TeamPagePerson[] {
  return input.people.map((person) => {
    const workerId = person.workerId;
    const daysOff = workerId
      ? input.daysOff
          .filter((d) => d.workerId === workerId && d.to >= input.today)
          .map((d) => ({ id: d.id, from: d.from, to: d.to, note: d.note }))
      : [];
    const stops = workerId ? (input.stops.get(workerId) ?? { total: 0, done: 0 }) : { total: 0, done: 0 };
    const usualRounds = workerId
      ? input.rounds
          .filter((r) => r.usualLeadWorkerId === workerId)
          .map((r) => ({ id: r.id, name: r.name, colour: r.colour }))
      : [];

    let today: TeamToday = 'no_stops';
    if (!person.endedAt && person.inviteStatus !== 'pending') {
      if (person.kind === 'helper') {
        today = input.workedToday.has(person.id) ? 'working' : 'no_stops';
      } else if (isOff(daysOff, input.today)) {
        today = 'off';
      } else if (stops.total === 0) {
        today = 'no_stops';
      } else {
        today = input.workedToday.has(person.id) ? 'working' : 'not_started';
      }
    }

    return {
      ...person,
      today,
      stopsToday: stops.total,
      doneToday: stops.done,
      usualRounds,
      heldCashPence: workerId ? (input.heldByWorker.get(workerId) ?? 0) : 0,
      daysOff,
    };
  });
}

/** Leads who are charged for: current, and not deactivated. A pending invite counts. */
export function countBilledLeads(people: ReadonlyArray<TeamPerson>): number {
  return people.filter((p) => p.kind === 'lead' && !p.endedAt && p.inviteStatus !== 'deactivated').length;
}
