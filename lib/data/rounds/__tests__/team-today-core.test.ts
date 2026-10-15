import { describe, expect, it } from 'vitest';
import type { TeamPerson } from '@/lib/team/types';
import { shapeTeamToday, type TeamTodayInput } from '../team-today-core';

const TODAY = '2026-10-12';

function lead(id: string, name: string, workerId: string, over: Partial<TeamPerson> = {}): TeamPerson {
  return { id, kind: 'lead', name, dayRatePence: 12000, usualDays: [1, 2, 3, 4, 5], workerId, inviteStatus: 'accepted', email: null, phone: null, endedAt: null, ...over };
}

const base: TeamTodayInput = {
  today: TODAY,
  hour: 10,
  people: [],
  owner: { workerId: 'wo', name: 'Owner' },
  daysOff: [],
  jobs: [],
  takenByWorker: new Map(),
  held: [],
  workedPersonIds: new Set(),
  helperRows: [],
  weekDays: [],
};

describe('shapeTeamToday', () => {
  it('is null with no team and no held cash', () => {
    expect(shapeTeamToday(base)).toBeNull();
  });

  it('shows progress, taken, holding and helpers for a lead who started', () => {
    const jobs = [
      ...Array.from({ length: 7 }, () => ({ workerId: 'w1', status: 'completed' })),
      ...Array.from({ length: 2 }, () => ({ workerId: 'w1', status: 'assigned' })),
    ];
    const t = shapeTeamToday({
      ...base,
      people: [lead('p1', 'Dave', 'w1')],
      jobs,
      takenByWorker: new Map([['w1', 60]]),
      held: [{ workerId: 'w1', name: 'Dave', total: 140 }],
      workedPersonIds: new Set(['p1']),
      helperRows: [{ helperName: 'Lee', withPersonId: 'p1' }],
    })!;
    const dave = t.people.find((p) => p.name === 'Dave')!;
    expect(dave).toMatchObject({ stops: 9, done: 7, takenToday: 60, holding: 140, startedToday: true, helpersToday: ['Lee'], showNotStarted: false });
    expect(t.holdingTotal).toBe(140);
  });

  it('flags Not started only after 09:00, only with stops, never the owner', () => {
    const people = [lead('p1', 'Dave', 'w1')];
    const jobs = [{ workerId: 'w1', status: 'assigned' }, { workerId: 'wo', status: 'assigned' }];
    const early = shapeTeamToday({ ...base, hour: 8, people, jobs })!;
    expect(early.people.find((p) => p.name === 'Dave')!.showNotStarted).toBe(false);
    const late = shapeTeamToday({ ...base, hour: 9, people, jobs })!;
    expect(late.people.find((p) => p.name === 'Dave')!.showNotStarted).toBe(true);
    expect(late.people.find((p) => p.isOwner)!.showNotStarted).toBe(false);
    const noStops = shapeTeamToday({ ...base, hour: 11, people })!;
    expect(noStops.people.find((p) => p.name === 'Dave')!.showNotStarted).toBe(false);
  });

  it('puts someone off today in the out line, not the rows, unless they still have stops', () => {
    const daysOff = [
      { id: 'd1', workerId: 'w2', from: '2026-10-12', to: '2026-10-14', note: null },
      { id: 'd2', workerId: 'w3', from: '2026-10-12', to: '2026-10-13', note: null },
    ];
    const t = shapeTeamToday({
      ...base,
      people: [lead('p2', 'Priya', 'w2'), lead('p3', 'Sam', 'w3')],
      daysOff,
      jobs: [{ workerId: 'w3', status: 'assigned' }],
    })!;
    expect(t.out).toEqual([{ name: 'Priya', until: '2026-10-14' }, { name: 'Sam', until: '2026-10-13' }]);
    expect(t.people.some((p) => p.name === 'Priya')).toBe(false);
    expect(t.people.find((p) => p.name === 'Sam')).toMatchObject({ stopsOnDayOff: true, stops: 1 });
  });

  it("keeps a removed lead's held cash visible with a Left the team marker", () => {
    const t = shapeTeamToday({
      ...base,
      people: [lead('p9', 'Tom', 'w9', { endedAt: '2026-10-01T00:00:00Z', inviteStatus: 'deactivated' })],
      held: [{ workerId: 'w9', name: 'Tom', total: 30 }],
    })!;
    expect(t.people.find((p) => p.name === 'Tom')).toMatchObject({ left: true, holding: 30 });
    expect(t.holdingTotal).toBe(30);
  });

  it('counts skipped visits separately from stops', () => {
    const t = shapeTeamToday({
      ...base,
      people: [lead('p1', 'Dave', 'w1')],
      jobs: [{ workerId: 'w1', status: 'completed' }, { workerId: 'w1', status: 'cancelled' }],
    })!;
    expect(t.people.find((p) => p.name === 'Dave')).toMatchObject({ stops: 1, done: 1, skipped: 1 });
  });
});
