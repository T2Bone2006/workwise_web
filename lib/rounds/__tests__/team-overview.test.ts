import { describe, expect, it } from 'vitest';
import { shapeTeamOverview } from '../team-overview';

const base = {
  id: 'p', kind: 'lead' as const, name: 'Dave', dayRatePence: 9000, usualDays: [1], workerId: 'w',
  inviteStatus: 'accepted' as const, email: 'd@x.co', phone: '07', endedAt: null,
  today: 'working' as const, stopsToday: 9, doneToday: 7, usualRounds: [], heldCashPence: 14000, daysOff: [],
};

describe('shapeTeamOverview', () => {
  it('keeps progress and held cash, and drops pay and contact details', () => {
    const out = shapeTeamOverview({ people: [base], heldTotalPence: 14000 });
    expect(out.people[0]).toEqual({
      personId: 'p', workerId: 'w', name: 'Dave', kind: 'lead', invitePending: false,
      today: 'working', stopsToday: 9, doneToday: 7, heldCashPence: 14000,
    });
    expect(JSON.stringify(out)).not.toMatch(/dayRate|email|phone|9000/);
  });
  it('leaves out people who have left or been switched off, and marks a pending invite', () => {
    const out = shapeTeamOverview({
      people: [
        { ...base, id: 'a', endedAt: '2026-10-01' },
        { ...base, id: 'b', inviteStatus: 'deactivated' },
        { ...base, id: 'c', inviteStatus: 'pending' },
      ],
      heldTotalPence: 0,
    });
    expect(out.people.map((p) => [p.personId, p.invitePending])).toEqual([['c', true]]);
  });
});
