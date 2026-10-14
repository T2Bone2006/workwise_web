import type { TeamPageData, TeamToday } from '@/lib/data/team-page-core';

/**
 * What the owner's phone needs to know about the team, and nothing more: who they are, how far along, who holds cash.
 * No pay, no rates, no contact details: those are the laptop's.
 */
export type TeamOverviewPerson = {
  personId: string;
  /** Leads only (workers.id): what their visits are assigned to. */
  workerId: string | null;
  name: string;
  kind: 'lead' | 'helper';
  invitePending: boolean;
  today: TeamToday;
  stopsToday: number;
  doneToday: number;
  heldCashPence: number;
};

export type TeamOverview = {
  people: TeamOverviewPerson[];
  heldTotalPence: number;
};

/** Pure. People who have left (or whose access was switched off) are not on the phone. */
export function shapeTeamOverview(data: Pick<TeamPageData, 'people' | 'heldTotalPence'>): TeamOverview {
  const people = data.people
    .filter((p) => !p.endedAt && p.inviteStatus !== 'deactivated')
    .map<TeamOverviewPerson>((p) => ({
      personId: p.id,
      workerId: p.workerId,
      name: p.name,
      kind: p.kind,
      invitePending: p.inviteStatus === 'pending',
      today: p.today,
      stopsToday: p.stopsToday,
      doneToday: p.doneToday,
      heldCashPence: p.heldCashPence,
    }));
  return { people, heldTotalPence: data.heldTotalPence };
}
