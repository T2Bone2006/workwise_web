import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { lastHelperIds, recordCrewDay } from '@/lib/team/crew-day';
import { fakeDb, type FakeDb } from './fake-db';

const T = 't1';
const TODAY = '2026-10-13';

function seed(): FakeDb {
  return fakeDb(
    {
      team_people: [
        { id: 'p-dave', tenant_id: T, kind: 'lead', name: 'Dave', day_rate_pence: 12000, ended_at: null },
        { id: 'p-sam', tenant_id: T, kind: 'lead', name: 'Sam', day_rate_pence: 11000, ended_at: null },
        { id: 'h-lee', tenant_id: T, kind: 'helper', name: 'Lee', day_rate_pence: 9000, ended_at: null },
        { id: 'h-kim', tenant_id: T, kind: 'helper', name: 'Kim', day_rate_pence: 0, ended_at: null },
        { id: 'h-old', tenant_id: T, kind: 'helper', name: 'Old', day_rate_pence: 5000, ended_at: '2026-01-01T00:00:00Z' },
        { id: 'p-other', tenant_id: 'other', kind: 'helper', name: 'Zed', day_rate_pence: 1, ended_at: null },
      ],
    },
    { unique: { work_days: [['tenant_id', 'work_date', 'person_id']] } },
  );
}

let db: FakeDb;
beforeEach(() => {
  db = seed();
});

const rows = () => db.rows('work_days').map((r) => `${r.person_id}:${r.role}:${r.rate_pence}:${r.with_person_id ?? '-'}:${r.source}`).sort();

describe('recordCrewDay', () => {
  it('records the lead and the helpers at their rates today', async () => {
    const result = await recordCrewDay(db.client, { tenantId: T, date: TODAY, leadPersonId: 'p-dave', helperIds: ['h-lee', 'h-kim'], today: TODAY });
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(rows()).toEqual(['h-kim:helper:0:p-dave:start_day', 'h-lee:helper:9000:p-dave:start_day', 'p-dave:lead:12000:-:start_day']);
  });

  it('pressing it twice, or replaying a queued one, changes nothing', async () => {
    const args = { tenantId: T, date: TODAY, leadPersonId: 'p-dave', helperIds: ['h-lee'], today: TODAY };
    await recordCrewDay(db.client, args);
    const again = await recordCrewDay(db.client, args);
    expect(again).toMatchObject({ ok: true, changed: false });
    expect(db.rows('work_days')).toHaveLength(2);
  });

  it('a correction removes only the helpers this lead’s start recorded, never a hand-added day or another lead’s', async () => {
    await recordCrewDay(db.client, { tenantId: T, date: TODAY, leadPersonId: 'p-dave', helperIds: ['h-lee', 'h-kim'], today: TODAY });
    db.rows('work_days').push({ id: 'manual', tenant_id: T, work_date: TODAY, person_id: 'h-old', role: 'helper', rate_pence: 5000, source: 'manual', with_person_id: null });
    const fix = await recordCrewDay(db.client, { tenantId: T, date: TODAY, leadPersonId: 'p-dave', helperIds: ['h-lee'], today: TODAY });
    expect(fix).toMatchObject({ ok: true, changed: true });
    expect(rows()).toEqual(['h-lee:helper:9000:p-dave:start_day', 'h-old:helper:5000:-:manual', 'p-dave:lead:12000:-:start_day']);

    // Sam also starts, with Dave’s helper Lee: Lee keeps his one row (Dave’s), and Sam’s start leaves Dave’s helpers alone.
    const sam = await recordCrewDay(db.client, { tenantId: T, date: TODAY, leadPersonId: 'p-sam', helperIds: ['h-lee'], today: TODAY });
    expect(sam).toMatchObject({ ok: true });
    expect(db.rows('work_days').filter((r) => r.person_id === 'h-lee')).toHaveLength(1);
    expect(db.rows('work_days').find((r) => r.person_id === 'h-lee')!.with_person_id).toBe('p-dave');
  });

  it('the owner starting their own day records helpers with no lead, and records no pay row for the owner', async () => {
    const result = await recordCrewDay(db.client, { tenantId: T, date: TODAY, leadPersonId: null, helperIds: ['h-lee'], today: TODAY });
    expect(result).toMatchObject({ ok: true, recorded: [{ personId: 'h-lee', role: 'helper' }] });
    expect(rows()).toEqual(['h-lee:helper:9000:-:start_day']);
    const none = await recordCrewDay(db.client, { tenantId: T, date: '2026-10-14', leadPersonId: null, helperIds: [], today: TODAY });
    expect(none).toMatchObject({ ok: true, recorded: [], changed: false });
  });

  it('accepts a start queued up to two days ago, refuses anything further out', async () => {
    expect((await recordCrewDay(db.client, { tenantId: T, date: '2026-10-11', leadPersonId: 'p-dave', helperIds: [], today: TODAY })).ok).toBe(true);
    expect(await recordCrewDay(db.client, { tenantId: T, date: '2026-10-10', leadPersonId: 'p-dave', helperIds: [], today: TODAY })).toEqual({ ok: false, error: 'That date is too far from today.' });
    expect(await recordCrewDay(db.client, { tenantId: T, date: '2026-10-16', leadPersonId: 'p-dave', helperIds: [], today: TODAY })).toEqual({ ok: false, error: 'That date is too far from today.' });
  });

  it('records another lead who is helping today, at their own rate, as one day with this lead', async () => {
    const result = await recordCrewDay(db.client, { tenantId: T, date: TODAY, leadPersonId: 'p-dave', helperIds: ['p-sam', 'h-lee'], today: TODAY });
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(rows()).toEqual([
      'h-lee:helper:9000:p-dave:start_day',
      'p-dave:lead:12000:-:start_day',
      'p-sam:helper:11000:p-dave:start_day',
    ]);
  });

  it('a lead who already started their own day is not paid a second time when someone ticks them', async () => {
    await recordCrewDay(db.client, { tenantId: T, date: TODAY, leadPersonId: 'p-sam', helperIds: [], today: TODAY });
    const withSam = await recordCrewDay(db.client, { tenantId: T, date: TODAY, leadPersonId: 'p-dave', helperIds: ['p-sam'], today: TODAY });
    expect(withSam).toMatchObject({ ok: true });
    expect(db.rows('work_days').filter((r) => r.person_id === 'p-sam')).toHaveLength(1);
    expect(db.rows('work_days').find((r) => r.person_id === 'p-sam')).toMatchObject({ role: 'lead', rate_pence: 11000 });
  });

  it('remembers a lead who came along last time, and forgets them once they leave the team', async () => {
    await recordCrewDay(db.client, { tenantId: T, date: TODAY, leadPersonId: 'p-dave', helperIds: ['p-sam'], today: TODAY });
    expect(await lastHelperIds(db.client, T, 'p-dave')).toEqual(['p-sam']);
    db.rows('team_people').find((r) => r.id === 'p-sam')!.ended_at = '2026-10-14T00:00:00Z';
    expect(await lastHelperIds(db.client, T, 'p-dave')).toEqual([]);
  });

  it('refuses an ended helper, another business, a made-up id, and the person starting the day', async () => {
    for (const ids of [['h-old'], ['p-other'], ['nope'], ['p-dave']]) {
      expect(await recordCrewDay(db.client, { tenantId: T, date: TODAY, leadPersonId: 'p-dave', helperIds: ids, today: TODAY })).toEqual({ ok: false, error: 'Pick helpers from your team list.' });
    }
    expect(await recordCrewDay(db.client, { tenantId: 'other', date: TODAY, leadPersonId: 'p-dave', helperIds: [], today: TODAY })).toEqual({ ok: false, error: 'Not found.' });
    expect(db.rows('work_days')).toHaveLength(0);
  });

  it('a rate of £0 is recorded (an unpaid helper still has a day)', async () => {
    await recordCrewDay(db.client, { tenantId: T, date: TODAY, leadPersonId: 'p-dave', helperIds: ['h-kim'], today: TODAY });
    expect(db.rows('work_days').find((r) => r.person_id === 'h-kim')!.rate_pence).toBe(0);
  });
});

describe('lastHelperIds', () => {
  it('is the helpers from this lead’s most recent day that had helpers, and only helpers still on the team', async () => {
    await recordCrewDay(db.client, { tenantId: T, date: '2026-10-12', leadPersonId: 'p-dave', helperIds: ['h-lee'], today: TODAY });
    await recordCrewDay(db.client, { tenantId: T, date: '2026-10-13', leadPersonId: 'p-dave', helperIds: ['h-lee', 'h-kim'], today: TODAY });
    expect((await lastHelperIds(db.client, T, 'p-dave')).sort()).toEqual(['h-kim', 'h-lee']);
    db.rows('team_people').find((r) => r.id === 'h-kim')!.ended_at = '2026-10-14T00:00:00Z';
    expect(await lastHelperIds(db.client, T, 'p-dave')).toEqual(['h-lee']);
  });

  it('is empty for a lead with no history, and the owner’s answers are kept apart from a lead’s', async () => {
    expect(await lastHelperIds(db.client, T, 'p-sam')).toEqual([]);
    await recordCrewDay(db.client, { tenantId: T, date: TODAY, leadPersonId: null, helperIds: ['h-kim'], today: TODAY });
    expect(await lastHelperIds(db.client, T, null)).toEqual(['h-kim']);
    expect(await lastHelperIds(db.client, T, 'p-dave')).toEqual([]);
  });
});
