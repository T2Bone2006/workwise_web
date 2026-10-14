import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { expandDaysOff, findStopsOnDaysOff } from '@/lib/team/days-off';
import { fakeDb } from './fake-db';

const T = 't1';

describe('expandDaysOff', () => {
  it('lists every day, sorted and without repeats, across overlapping ranges', () => {
    expect(
      expandDaysOff([
        { from: '2026-10-12', to: '2026-10-14' },
        { from: '2026-10-13', to: '2026-10-15' },
      ]),
    ).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15']);
  });
  it('handles one day, none, and month ends', () => {
    expect(expandDaysOff([{ from: '2026-10-31', to: '2026-11-01' }])).toEqual(['2026-10-31', '2026-11-01']);
    expect(expandDaysOff([])).toEqual([]);
  });
});

describe('findStopsOnDaysOff', () => {
  const db = () =>
    fakeDb({
      workers: [
        { id: 'w-owner', primary_tenant_id: T, worker_type: 'platform_solo', full_name: 'Sam' },
        { id: 'w-dave', primary_tenant_id: T, worker_type: 'employee' },
      ],
      team_people: [{ id: 'p', tenant_id: T, kind: 'lead', worker_id: 'w-dave', name: 'Dave' }],
      team_days_off: [
        { id: 'd1', tenant_id: T, worker_id: 'w-dave', from_date: '2026-10-12', to_date: '2026-10-13' },
        { id: 'd2', tenant_id: T, worker_id: 'w-owner', from_date: '2026-10-20', to_date: '2026-10-21' },
        { id: 'd3', tenant_id: 'other', worker_id: 'w-x', from_date: '2026-10-12', to_date: '2026-10-13' },
      ],
      jobs: [
        { id: 'j1', tenant_id: T, assigned_worker_id: 'w-dave', status: 'assigned', scheduled_date: '2026-10-12' },
        { id: 'j2', tenant_id: T, assigned_worker_id: 'w-dave', status: 'assigned', scheduled_date: '2026-10-12' },
        { id: 'j3', tenant_id: T, assigned_worker_id: 'w-dave', status: 'completed', scheduled_date: '2026-10-12' },
        { id: 'j4', tenant_id: T, assigned_worker_id: 'w-dave', status: 'assigned', scheduled_date: '2026-10-14' },
        { id: 'j5', tenant_id: T, assigned_worker_id: 'w-dave', status: 'assigned', scheduled_date: '2026-10-13' },
      ],
    });

  it('counts open visits on a day off, per person and day', async () => {
    const out = await findStopsOnDaysOff(db().client, T, '2026-10-01', '2026-10-31');
    expect(out).toEqual([
      { workerId: 'w-dave', workerName: 'Dave', date: '2026-10-12', visitCount: 2 },
      { workerId: 'w-dave', workerName: 'Dave', date: '2026-10-13', visitCount: 1 },
    ]);
  });

  it('only looks inside the dates asked for, and finds nothing when no one is off', async () => {
    expect(await findStopsOnDaysOff(db().client, T, '2026-10-13', '2026-10-13')).toEqual([
      { workerId: 'w-dave', workerName: 'Dave', date: '2026-10-13', visitCount: 1 },
    ]);
    expect(await findStopsOnDaysOff(db().client, T, '2026-12-01', '2026-12-31')).toEqual([]);
  });

  it('names the owner "You" and ignores another business', async () => {
    const d = db();
    d.rows('jobs').push({ id: 'j9', tenant_id: T, assigned_worker_id: 'w-owner', status: 'assigned', scheduled_date: '2026-10-20' });
    const out = await findStopsOnDaysOff(d.client, T, '2026-10-01', '2026-10-31');
    expect(out.find((s) => s.workerId === 'w-owner')).toEqual({ workerId: 'w-owner', workerName: 'You', date: '2026-10-20', visitCount: 1 });
    expect(out.some((s) => s.workerId === 'w-x')).toBe(false);
  });
});
