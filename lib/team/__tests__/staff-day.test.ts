import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { getStaffDay, getStaffRange } from '@/lib/team/staff-day';
import { fakeDb, type FakeDb } from './fake-db';

const T = 't1';
const ctx = { tenantId: T, workerId: 'w-dave', personId: 'p-dave' };
const D = '2026-10-13';

function seed(): FakeDb {
  return fakeDb({
    customers: [
      { id: 'c1', tenant_id: T, name: 'Mrs Patel', phone: '07700900111', access_notes: 'Gate code 4471', added_by_worker_id: 'w-dave' },
      { id: 'c2', tenant_id: T, name: 'Mr Jones', phone: null, access_notes: null, added_by_worker_id: null },
    ],
    service_agreements: [{ id: 'a1', tenant_id: T, access_notes: 'Side gate is open' }],
    customer_balances: [
      { tenant_id: T, customer_id: 'c1', owed_amount: 20 },
      { tenant_id: T, customer_id: 'c2', owed_amount: 0 },
    ],
    jobs: [
      { id: 'j1', tenant_id: T, assigned_worker_id: 'w-dave', customer_id: 'c1', scheduled_date: D, status: 'assigned', route_position: 2, address: '12 Oak Road', postcode: 'LS6 1AA', quoted_amount: '14.00', job_description: 'Windows\nextra', service_agreement_id: 'a1' },
      { id: 'j2', tenant_id: T, assigned_worker_id: 'w-dave', customer_id: 'c2', scheduled_date: D, status: 'completed', route_position: 1, address: '3 Elm St', postcode: 'LS6 2BB', quoted_amount: 18, job_description: 'Windows' },
      { id: 'j3', tenant_id: T, assigned_worker_id: 'w-dave', customer_id: 'c2', scheduled_date: D, status: 'pending_send', route_position: 3 },
      { id: 'j4', tenant_id: T, assigned_worker_id: 'w-lee', customer_id: 'c1', scheduled_date: D, status: 'assigned', route_position: 1 },
      { id: 'j5', tenant_id: 'other', assigned_worker_id: 'w-dave', customer_id: 'c1', scheduled_date: D, status: 'assigned' },
      { id: 'j6', tenant_id: T, assigned_worker_id: 'w-dave', customer_id: 'c1', scheduled_date: '2026-10-14', status: 'assigned', quoted_amount: 10 },
      { id: 'j7', tenant_id: T, assigned_worker_id: 'w-dave', customer_id: 'c1', scheduled_date: '2026-10-14', status: 'cancelled', quoted_amount: 10 },
    ],
    payments: [
      { id: 'pay1', tenant_id: T, status: 'active', collected_by_worker_id: 'w-dave', handed_over_at: null, amount: 20, applies_to_job_id: 'j2' },
      { id: 'pay2', tenant_id: T, status: 'active', collected_by_worker_id: 'w-dave', handed_over_at: null, amount: 5.5, applies_to_job_id: null },
      { id: 'pay3', tenant_id: T, status: 'active', collected_by_worker_id: 'w-dave', handed_over_at: '2026-10-01T10:00:00Z', amount: 99, applies_to_job_id: 'j2' },
      { id: 'pay4', tenant_id: T, status: 'active', collected_by_worker_id: 'w-lee', handed_over_at: null, amount: 77, applies_to_job_id: 'j4' },
      { id: 'pay5', tenant_id: T, status: 'void', collected_by_worker_id: 'w-dave', handed_over_at: null, amount: 33, applies_to_job_id: 'j2' },
    ],
    team_people: [
      { id: 'p-dave', tenant_id: T, kind: 'lead', worker_id: 'w-dave', name: 'Dave', ended_at: null },
      { id: 'p-sam', tenant_id: T, kind: 'lead', worker_id: 'w-sam', name: 'Sam', ended_at: null },
      { id: 'h-lee', tenant_id: T, kind: 'helper', worker_id: null, name: 'Lee', ended_at: null },
      { id: 'h-old', tenant_id: T, kind: 'helper', worker_id: null, name: 'Old', ended_at: '2026-01-01T00:00:00Z' },
    ],
    work_days: [{ id: 'wd1', tenant_id: T, work_date: '2026-10-12', person_id: 'h-lee', role: 'helper', source: 'start_day', with_person_id: 'p-dave' }],
  });
}

let db: FakeDb;
beforeEach(() => {
  db = seed();
});

describe('getStaffDay', () => {
  it('has only this member of staff’s stops, in route order, with the phone number, price and what the customer owes', async () => {
    const day = await getStaffDay(db.client, ctx, D);
    expect(day.stops.map((s) => s.jobId)).toEqual(['j2', 'j1']);
    const mrsPatel = day.stops.find((s) => s.jobId === 'j1')!;
    expect(mrsPatel).toMatchObject({
      customerName: 'Mrs Patel', phone: '07700900111', address: '12 Oak Road', postcode: 'LS6 1AA',
      title: 'Windows', price: 14, customerOwes: 20, addedByMe: true, accessNotes: 'Side gate is open',
    });
    expect(day.stops.find((s) => s.jobId === 'j2')).toMatchObject({ phone: null, customerOwes: 0, addedByMe: false, heldByMeForThisVisit: 20 });
  });

  it('adds up the day: done count, planned £, cash held (only theirs, active, not handed over)', async () => {
    const day = await getStaffDay(db.client, ctx, D);
    expect(day.doneCount).toBe(1);
    expect(day.plannedAmount).toBe(32);
    expect(day.heldTotal).toBe(25.5);
  });

  it('never shows another person’s visits, another business’s, or work that has not been sent out', async () => {
    const day = await getStaffDay(db.client, ctx, D);
    const ids = day.stops.map((s) => s.jobId);
    expect(ids).not.toContain('j3');
    expect(ids).not.toContain('j4');
    expect(ids).not.toContain('j5');
  });

  it('says whether they have started, what helpers they can pick, and who they went out with last time', async () => {
    const day = await getStaffDay(db.client, ctx, D);
    expect(day.started).toBe(false);
    expect(day.helpers).toEqual([{ id: 'h-lee', name: 'Lee', kind: 'helper' }, { id: 'p-sam', name: 'Sam', kind: 'lead' }]);
    expect(day.lastHelperIds).toEqual(['h-lee']);
    db.rows('work_days').push({ id: 'wd2', tenant_id: T, work_date: D, person_id: 'p-dave', role: 'lead', source: 'start_day' });
    expect((await getStaffDay(db.client, ctx, D)).started).toBe(true);
  });

  it('gives an empty day for a day with no stops, and carries no money or pay fields', async () => {
    const day = await getStaffDay(db.client, ctx, '2026-11-01');
    expect(day.stops).toEqual([]);
    expect(Object.keys(day).sort()).toEqual(['date', 'doneCount', 'heldTotal', 'helpers', 'lastHelperIds', 'plannedAmount', 'started', 'stops']);
    expect(JSON.stringify(day)).not.toMatch(/rate|earned|wage|owed_amount/i);
  });

  it('throws (so the route answers 503) when the visits cannot be read', async () => {
    const original = db.from.bind(db);
    db.from = ((table: string) => (table === 'jobs' ? { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ not: async () => ({ data: null, error: { message: 'boom' } }) }) }) }) }) } : original(table))) as never;
    await expect(getStaffDay(db.client, ctx, D)).rejects.toThrow('Could not load the day.');
  });
});

describe('getStaffRange', () => {
  it('counts each day of their own visits and fills quiet days with zeros', async () => {
    const r = await getStaffRange(db.client, ctx, '2026-10-12', '2026-10-14');
    expect(r).toEqual({
      ok: true,
      days: [
        { date: '2026-10-12', total: 0, done: 0, plannedAmount: 0 },
        { date: D, total: 2, done: 1, plannedAmount: 32 },
        { date: '2026-10-14', total: 2, done: 0, plannedAmount: 10 },
      ],
    });
  });

  it('refuses a bad or too-long range', async () => {
    expect(await getStaffRange(db.client, ctx, 'x', 'y')).toEqual({ ok: false, error: 'Pick a valid range.' });
    expect(await getStaffRange(db.client, ctx, '2026-10-14', '2026-10-12')).toEqual({ ok: false, error: 'Pick a valid range.' });
    expect(await getStaffRange(db.client, ctx, '2026-01-01', '2026-12-31')).toEqual({ ok: false, error: 'Pick 62 days or fewer.' });
  });
});
