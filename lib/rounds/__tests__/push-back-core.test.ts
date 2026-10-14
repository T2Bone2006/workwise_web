import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { previewPushBack, pushBackWithLog } from '@/lib/rounds/push-back-core';
import { undoVisitChangeCore } from '@/lib/rounds/visit-changes';
import { listUntoldMoves } from '@/lib/rounds/visit-changes';
import { fakeDb, type FakeDb } from '../../team/__tests__/fake-db';

const T = 'tenant-1';
const TODAY = '2026-10-09'; // Friday
const ACTOR = { userId: 'owner-user' };
const MON = '2026-10-12';
const day = (offset: number) => {
  const d = new Date(`${MON}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

// Dave (w-dave) works Mon–Thu. Two weeks of visits, one house per day, a weekly customer on Monday.
function seed(): FakeDb {
  const jobs = [];
  for (const week of [0, 7]) {
    for (const d of [0, 1, 2, 3]) {
      jobs.push({
        id: `j${week}${d}`,
        tenant_id: T,
        assigned_worker_id: 'w-dave',
        status: 'assigned',
        scheduled_date: day(week + d),
        route_position: 1,
        service_agreement_id: `a${week}${d}`,
        customer_id: `c${week}${d}`,
      });
    }
  }
  return fakeDb(
    {
      workers: [{ id: 'w-dave', primary_tenant_id: T }],
      team_people: [{ id: 'p-dave', tenant_id: T, kind: 'lead', worker_id: 'w-dave', usual_days: [1, 2, 3, 4], ended_at: null }],
      jobs,
      service_agreements: jobs.map((j) => ({ id: j.service_agreement_id, tenant_id: T, next_due_date: day(60) })),
      customers: jobs.map((j) => ({ id: j.customer_id, tenant_id: T, name: `Customer ${j.id}` })),
      tenants: [{ id: T, settings: {} }],
    },
    { defaults: { visit_changes: { created_at: new Date().toISOString(), undone_at: null, notified_at: null } } },
  );
}

let db: FakeDb;
beforeEach(() => {
  db = seed();
});

const dateOf = (id: string) => db.rows('jobs').find((j) => j.id === id)!.scheduled_date;

describe('previewPushBack', () => {
  it('describes the slide without changing anything', async () => {
    const result = await previewPushBack(db.client, { tenantId: T, workerId: 'w-dave', offFrom: day(0), offTo: day(1), today: TODAY });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.plan.moves.length).toBeGreaterThan(0);
    expect(result.lastDate).toBe(day(11)); // the Friday of week two
    expect(result.sample).toHaveLength(5);
    expect(result.sample[0]).toMatchObject({ customerName: 'Customer j00', from: day(0), to: day(2) });
    expect(dateOf('j00')).toBe(day(0));
    expect(db.rows('visit_changes')).toHaveLength(0);
  });

  it('refuses days that have already passed', async () => {
    expect(await previewPushBack(db.client, { tenantId: T, workerId: 'w-dave', offFrom: '2026-10-01', offTo: '2026-10-02', today: TODAY })).toEqual({
      success: false,
      error: 'Those days have already passed.',
    });
  });

  it('uses the business working days for the owner’s own round (no team person)', async () => {
    db.rows('team_people').length = 0;
    const result = await previewPushBack(db.client, { tenantId: T, workerId: 'w-dave', offFrom: day(0), offTo: day(0), today: TODAY });
    expect(result.success).toBe(true);
  });
});

describe('pushBackWithLog', () => {
  it('slides the visits, logs one push_back change with each visit’s new day, and does not text anyone', async () => {
    const result = await pushBackWithLog(db.client, { tenantId: T, workerId: 'w-dave', offFrom: day(0), offTo: day(1), actor: ACTOR, today: TODAY });
    expect(result).toMatchObject({ success: true, stuck: 0 });
    if (!result.success) return;
    expect(result.moved).toBe(8);
    expect(dateOf('j00')).toBe(day(2));
    expect(dateOf('j01')).toBe(day(3));
    expect(dateOf('j02')).toBe(day(4));
    expect(dateOf('j03')).toBe(day(7));
    expect(dateOf('j70')).toBe(day(8));
    expect(dateOf('j73')).toBe(day(11));

    const changes = db.rows('visit_changes');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: 'push_back', from_date: day(0), to_date: day(11), notify_customers: false });
    const before = changes[0].before as Array<Record<string, unknown>>;
    expect(before.find((s) => s.job_id === 'j00')).toMatchObject({ scheduled_date: day(0), after_date: day(2) });
    expect(db.rows('job_status_history')).toHaveLength(8);
    // The following visits of each customer are not regenerated or shifted.
    expect(db.rows('service_agreements').every((a) => a.next_due_date === day(60))).toBe(true);
  });

  it('a second identical run moves nothing and records nothing', async () => {
    await pushBackWithLog(db.client, { tenantId: T, workerId: 'w-dave', offFrom: day(0), offTo: day(1), actor: ACTOR, today: TODAY });
    const again = await pushBackWithLog(db.client, { tenantId: T, workerId: 'w-dave', offFrom: day(0), offTo: day(1), actor: ACTOR, today: TODAY });
    expect(again).toMatchObject({ success: true, moved: 0, changeId: null });
    expect(db.rows('visit_changes')).toHaveLength(1);
  });

  it('leaves a visit that was finished since it was planned, and moves the rest', async () => {
    const plan = await previewPushBack(db.client, { tenantId: T, workerId: 'w-dave', offFrom: day(0), offTo: day(1), today: TODAY });
    expect(plan.success).toBe(true);
    db.rows('jobs').find((j) => j.id === 'j00')!.status = 'completed';
    const result = await pushBackWithLog(db.client, { tenantId: T, workerId: 'w-dave', offFrom: day(0), offTo: day(1), actor: ACTOR, today: TODAY });
    expect(result.success && result.moved).toBeGreaterThan(0);
    expect(dateOf('j00')).toBe(day(0));
  });

  it('does not move a visit that was given to someone else', async () => {
    db.rows('jobs').find((j) => j.id === 'j01')!.assigned_worker_id = 'w-lee';
    await pushBackWithLog(db.client, { tenantId: T, workerId: 'w-dave', offFrom: day(0), offTo: day(1), actor: ACTOR, today: TODAY });
    expect(dateOf('j01')).toBe(day(1));
  });

  it('holds back a visit whose next visit is too soon and reports it', async () => {
    // A weekly customer: the same agreement has another open visit on Wednesday.
    db.rows('jobs').push({
      id: 'weekly-next', tenant_id: T, assigned_worker_id: 'w-lee', status: 'assigned', scheduled_date: day(2),
      route_position: 1, service_agreement_id: 'a00', customer_id: 'c00',
    });
    const result = await pushBackWithLog(db.client, { tenantId: T, workerId: 'w-dave', offFrom: day(0), offTo: day(1), actor: ACTOR, today: TODAY });
    expect(result.success && result.stuck).toBe(1);
    expect(dateOf('j00')).toBe(day(0));
  });

  it('Undo puts the visits back where they were', async () => {
    const result = await pushBackWithLog(db.client, { tenantId: T, workerId: 'w-dave', offFrom: day(0), offTo: day(1), actor: ACTOR, today: TODAY });
    if (!result.success || !result.changeId) throw new Error('expected a change');
    const undone = await undoVisitChangeCore(db.client, { tenantId: T, changeId: result.changeId, actor: ACTOR });
    expect(undone).toMatchObject({ success: true, restored: 8, leftAlone: 0 });
    expect(dateOf('j00')).toBe(day(0));
    expect(dateOf('j03')).toBe(day(3));
    expect(dateOf('j73')).toBe(day(10));
  });

  it('shows up as a move customers have not been told about', async () => {
    await pushBackWithLog(db.client, { tenantId: T, workerId: 'w-dave', offFrom: day(0), offTo: day(1), actor: ACTOR, today: TODAY });
    const untold = await listUntoldMoves(db.client, T, { today: TODAY });
    expect(untold).toHaveLength(1);
    expect(untold?.[0]).toMatchObject({ kind: 'push_back' });
    expect(untold?.[0].jobs.find((j) => j.jobId === 'j00')).toEqual({ jobId: 'j00', fromDate: day(0), toDate: day(2) });
  });
});
