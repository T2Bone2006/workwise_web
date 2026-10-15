import { beforeEach, describe, expect, it, vi } from 'vitest';

const reconcile = vi.fn();
vi.mock('@/lib/billing/rounds-team', () => ({
  reconcileRoundsTeamAfterChange: (...a: unknown[]) => reconcile(...a),
}));
vi.mock('server-only', () => ({}));

import { addDayOff, addHelper, endHelper, removeDayOff, removeLead, setDayRate, updatePerson } from '@/lib/team/team-core';
import { fakeDb, type FakeDb } from './fake-db';

const T = 'tenant-1';
const OTHER = 'tenant-2';

function seed(): FakeDb {
  return fakeDb({
    workers: [
      { id: 'w-owner', primary_tenant_id: T, worker_type: 'platform_solo', invite_status: 'accepted', user_id: 'u-owner' },
      { id: 'w-dave', primary_tenant_id: T, worker_type: 'employee', invite_status: 'accepted', user_id: 'u-dave' },
    ],
    team_people: [
      { id: 'p-dave', tenant_id: T, kind: 'lead', worker_id: 'w-dave', name: 'Dave', day_rate_pence: 12000, usual_days: [1, 2, 3, 4], ended_at: null },
      { id: 'p-lee', tenant_id: T, kind: 'helper', worker_id: null, name: 'Lee', day_rate_pence: 9000, usual_days: [1, 2, 3, 4], ended_at: null },
      { id: 'p-other', tenant_id: OTHER, kind: 'helper', worker_id: null, name: 'Zed', day_rate_pence: 0, usual_days: [1], ended_at: null },
    ],
    jobs: [
      { id: 'j1', tenant_id: T, assigned_worker_id: 'w-dave', status: 'assigned', scheduled_date: '2099-01-05' },
      { id: 'j2', tenant_id: T, assigned_worker_id: 'w-dave', status: 'completed', scheduled_date: '2099-01-05' },
      { id: 'j3', tenant_id: T, assigned_worker_id: 'w-dave', status: 'assigned', scheduled_date: '2000-01-05' },
      { id: 'j4', tenant_id: T, assigned_worker_id: 'w-owner', status: 'assigned', scheduled_date: '2099-01-05' },
    ],
    rounds: [{ id: 'r1', tenant_id: T, usual_lead_worker_id: 'w-dave' }],
    payments: [
      { id: 'pay1', tenant_id: T, amount: 20, status: 'active', collected_by_worker_id: 'w-dave', handed_over_at: null },
      { id: 'pay2', tenant_id: T, amount: 25.5, status: 'active', collected_by_worker_id: 'w-dave', handed_over_at: null },
      { id: 'pay3', tenant_id: T, amount: 99, status: 'active', collected_by_worker_id: 'w-dave', handed_over_at: '2026-10-01T10:00:00Z' },
    ],
  });
}

let db: FakeDb;
beforeEach(() => {
  db = seed();
  reconcile.mockReset();
});

describe('addHelper', () => {
  it('adds a helper with no worker row, login or invite', async () => {
    const before = db.rows('workers').length;
    const result = await addHelper(db.client, T, { name: ' Sam ', dayRatePence: 8000, usualDays: [1, 2] });
    expect(result.ok).toBe(true);
    expect(db.rows('workers')).toHaveLength(before);
    const row = db.rows('team_people').find((r) => r.name === 'Sam');
    expect(row).toMatchObject({ kind: 'helper', worker_id: null, tenant_id: T, day_rate_pence: 8000 });
  });

  it('refuses a duplicate name among active people, ignoring case', async () => {
    const result = await addHelper(db.client, T, { name: 'lee', dayRatePence: 0, usualDays: [1] });
    expect(result).toEqual({ ok: false, error: 'A person called lee already exists.' });
  });

  it('allows a name another business uses', async () => {
    expect((await addHelper(db.client, T, { name: 'Zed', dayRatePence: 0, usualDays: [1] })).ok).toBe(true);
  });

  it('allows the name of someone who has left', async () => {
    db.rows('team_people').find((r) => r.id === 'p-lee')!.ended_at = '2026-01-01T00:00:00Z';
    expect((await addHelper(db.client, T, { name: 'Lee', dayRatePence: 0, usualDays: [1] })).ok).toBe(true);
  });
});

describe('updatePerson / setDayRate / endHelper', () => {
  it('changes the rate for a person of this business only', async () => {
    expect((await setDayRate(db.client, T, 'p-dave', 13000)).ok).toBe(true);
    expect(db.rows('team_people').find((r) => r.id === 'p-dave')!.day_rate_pence).toBe(13000);
    expect(await setDayRate(db.client, T, 'p-other', 1)).toEqual({ ok: false, error: 'Not found.' });
    expect(db.rows('team_people').find((r) => r.id === 'p-other')!.day_rate_pence).toBe(0);
  });

  it('refuses renaming onto someone else’s name', async () => {
    expect(await updatePerson(db.client, T, 'p-lee', { name: 'DAVE' })).toEqual({
      ok: false,
      error: 'A person called DAVE already exists.',
    });
  });

  it('ends a helper without deleting them, and twice is fine', async () => {
    expect((await endHelper(db.client, T, 'p-lee')).ok).toBe(true);
    expect(db.rows('team_people').find((r) => r.id === 'p-lee')!.ended_at).not.toBeNull();
    expect((await endHelper(db.client, T, 'p-lee')).ok).toBe(true);
    expect(await endHelper(db.client, T, 'p-dave')).toEqual({ ok: false, error: 'Not found.' });
  });
});

describe('days off', () => {
  const input = { workerId: 'w-dave', from: '2099-01-05', to: '2099-01-06', note: 'Holiday' };

  it('saves a day off for a lead and for the owner’s own worker', async () => {
    expect((await addDayOff(db.client, T, input)).ok).toBe(true);
    expect((await addDayOff(db.client, T, { ...input, workerId: 'w-owner' })).ok).toBe(true);
    expect(db.rows('team_days_off')).toHaveLength(2);
  });

  it('saving the same range twice makes one row', async () => {
    await addDayOff(db.client, T, input);
    const again = await addDayOff(db.client, T, input);
    expect(again).toMatchObject({ ok: true, alreadySaved: true });
    expect(db.rows('team_days_off')).toHaveLength(1);
  });

  it('refuses a worker of another business and a deactivated worker', async () => {
    expect(await addDayOff(db.client, OTHER, input)).toEqual({ ok: false, error: 'Not found.' });
    db.rows('workers').find((r) => r.id === 'w-dave')!.invite_status = 'deactivated';
    expect(await addDayOff(db.client, T, input)).toEqual({ ok: false, error: 'Not found.' });
  });

  it('removes only a day off of this business', async () => {
    db.rows('team_days_off').push({ id: 'd1', tenant_id: T }, { id: 'd2', tenant_id: OTHER });
    await removeDayOff(db.client, T, 'd2');
    expect(db.rows('team_days_off')).toHaveLength(2);
    await removeDayOff(db.client, T, 'd1');
    expect(db.rows('team_days_off').map((r) => r.id)).toEqual(['d2']);
  });
});

describe('removeLead', () => {
  it('switches the login off, deactivates, ends the person, returns future open visits, clears the round and counts held cash', async () => {
    const result = await removeLead(db.client, T, 'p-dave', { at: new Date('2026-10-10T09:00:00Z') });
    expect(result).toEqual({ ok: true, loggedOut: true, visitsReturned: 1, heldCashPence: 4550 });

    expect(db.authBanCalls).toEqual([{ id: 'u-dave', attrs: { ban_duration: '876000h' } }]);
    expect(db.rows('workers').find((r) => r.id === 'w-dave')).toMatchObject({ invite_status: 'deactivated', status: 'unavailable' });
    expect(db.rows('team_people').find((r) => r.id === 'p-dave')!.ended_at).not.toBeNull();
    const jobs = Object.fromEntries(db.rows('jobs').map((j) => [j.id, j.assigned_worker_id]));
    expect(jobs).toEqual({ j1: 'w-owner', j2: 'w-dave', j3: 'w-dave', j4: 'w-owner' });
    expect(db.rows('rounds')[0].usual_lead_worker_id).toBeNull();
    // Held cash, history and pay are left exactly as they were.
    expect(db.rows('payments').map((p) => p.handed_over_at)).toEqual([null, null, '2026-10-01T10:00:00Z']);
    expect(reconcile).toHaveBeenCalledWith(T);
  });

  it('does nothing else when the login cannot be switched off', async () => {
    db.authBanError = { message: 'auth down' };
    const result = await removeLead(db.client, T, 'p-dave');
    expect(result).toEqual({ ok: false, error: "Couldn't switch off their login. Nothing was changed." });
    expect(db.rows('workers').find((r) => r.id === 'w-dave')!.invite_status).toBe('accepted');
    expect(db.rows('team_people').find((r) => r.id === 'p-dave')!.ended_at).toBeNull();
    expect(db.rows('jobs').find((j) => j.id === 'j1')!.assigned_worker_id).toBe('w-dave');
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('is safe to run twice', async () => {
    await removeLead(db.client, T, 'p-dave');
    reconcile.mockReset();
    const again = await removeLead(db.client, T, 'p-dave');
    expect(again).toMatchObject({ ok: true, visitsReturned: 0, heldCashPence: 4550 });
    expect(db.authBanCalls).toHaveLength(1);
  });

  it('refuses a helper, another business’s person, and an unknown id', async () => {
    expect(await removeLead(db.client, T, 'p-lee')).toEqual({ ok: false, error: 'Not found.' });
    expect(await removeLead(db.client, T, 'p-other')).toEqual({ ok: false, error: 'Not found.' });
    expect(await removeLead(db.client, OTHER, 'p-dave')).toEqual({ ok: false, error: 'Not found.' });
    expect(await removeLead(db.client, T, 'nope')).toEqual({ ok: false, error: 'Not found.' });
    expect(db.authBanCalls).toHaveLength(0);
  });
});
