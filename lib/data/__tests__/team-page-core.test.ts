import { describe, expect, it } from 'vitest';
import { countBilledLeads, shapePeople } from '../team-page-core';
import type { TeamPerson } from '@/lib/team/types';

const TODAY = '2026-10-12';

function person(over: Partial<TeamPerson>): TeamPerson {
  return {
    id: 'p1',
    kind: 'lead',
    name: 'Dave',
    dayRatePence: 12000,
    usualDays: [1, 2, 3, 4, 5],
    workerId: 'w1',
    inviteStatus: 'accepted',
    email: null,
    phone: null,
    endedAt: null,
    ...over,
  };
}

const base = {
  daysOff: [],
  rounds: [],
  stops: new Map<string, { total: number; done: number }>(),
  workedToday: new Set<string>(),
  heldByWorker: new Map<string, number>(),
  today: TODAY,
};

describe('shapePeople', () => {
  it('lead with stops who pressed Start day is working', () => {
    const [dave] = shapePeople({
      ...base,
      people: [person({})],
      stops: new Map([['w1', { total: 9, done: 5 }]]),
      workedToday: new Set(['p1']),
    });
    expect(dave).toMatchObject({ today: 'working', stopsToday: 9, doneToday: 5 });
  });

  it('lead with stops who has not started is not_started', () => {
    const [dave] = shapePeople({ ...base, people: [person({})], stops: new Map([['w1', { total: 4, done: 0 }]]) });
    expect(dave!.today).toBe('not_started');
  });

  it('a day off beats stops and usual days', () => {
    const [dave] = shapePeople({
      ...base,
      people: [person({})],
      stops: new Map([['w1', { total: 4, done: 0 }]]),
      daysOff: [{ id: 'd1', workerId: 'w1', from: '2026-10-11', to: '2026-10-13', note: null }],
    });
    expect(dave!.today).toBe('off');
    expect(dave!.daysOff).toHaveLength(1);
  });

  it('a lead with no stops shows no_stops, and past days off are left out', () => {
    const [dave] = shapePeople({
      ...base,
      people: [person({})],
      daysOff: [{ id: 'd0', workerId: 'w1', from: '2026-10-01', to: '2026-10-02', note: null }],
    });
    expect(dave!.today).toBe('no_stops');
    expect(dave!.daysOff).toEqual([]);
  });

  it('a pending lead and an ended person get no today status', () => {
    const shaped = shapePeople({
      ...base,
      people: [person({ id: 'a', inviteStatus: 'pending' }), person({ id: 'b', workerId: 'w2', endedAt: '2026-10-01T00:00:00Z' })],
      stops: new Map([['w2', { total: 3, done: 0 }]]),
    });
    expect(shaped.map((p) => p.today)).toEqual(['no_stops', 'no_stops']);
  });

  it('helpers are working only when a day is recorded', () => {
    const helper = person({ id: 'h1', kind: 'helper', workerId: null, inviteStatus: null, name: 'Lee' });
    expect(shapePeople({ ...base, people: [helper] })[0]!.today).toBe('no_stops');
    expect(shapePeople({ ...base, people: [helper], workedToday: new Set(['h1']) })[0]!.today).toBe('working');
  });

  it('attaches usual rounds and held cash by worker', () => {
    const [dave] = shapePeople({
      ...base,
      people: [person({})],
      rounds: [
        { id: 'r1', name: 'Tuesday north', colour: '#7c3aed', usualLeadWorkerId: 'w1' },
        { id: 'r2', name: 'Friday', colour: '#0891b2', usualLeadWorkerId: null },
      ],
      heldByWorker: new Map([['w1', 4500]]),
    });
    expect(dave!.usualRounds).toEqual([{ id: 'r1', name: 'Tuesday north', colour: '#7c3aed' }]);
    expect(dave!.heldCashPence).toBe(4500);
  });
});

describe('countBilledLeads', () => {
  it('counts current and pending leads, not helpers, ended or deactivated', () => {
    expect(
      countBilledLeads([
        person({ id: '1' }),
        person({ id: '2', inviteStatus: 'pending' }),
        person({ id: '3', kind: 'helper', workerId: null, inviteStatus: null }),
        person({ id: '4', endedAt: '2026-10-01T00:00:00Z' }),
        person({ id: '5', inviteStatus: 'deactivated' }),
      ]),
    ).toBe(2);
  });
});
