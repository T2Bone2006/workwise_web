import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { clearWorkerCash, listHeldCash, markHandedOver, recentHandIns, undoHandOver } from '@/lib/team/hand-in';
import { fakeDb, type FakeDb } from './fake-db';

const T = 't1';
const TODAY = '2026-10-13';
const base = { tenantId: T, userId: 'owner', today: TODAY };

function seed(): FakeDb {
  const db = fakeDb({
    customers: [{ id: 'c1', tenant_id: T, name: 'Mrs Patel' }, { id: 'c2', tenant_id: T, name: 'Mr Jones' }],
    jobs: [{ id: 'j1', tenant_id: T, job_description: 'Windows\nx' }],
    team_people: [{ id: 'p-dave', tenant_id: T, kind: 'lead', worker_id: 'w-dave', name: 'Dave' }],
    payments: [
      { id: 'a', tenant_id: T, status: 'active', customer_id: 'c1', amount: 20, method: 'cash', received_at: '2026-10-10T09:00:00Z', applies_to_job_id: 'j1', collected_by_worker_id: 'w-dave', collected_by_name: 'Dave', handed_over_at: null },
      { id: 'b', tenant_id: T, status: 'active', customer_id: 'c2', amount: 5.5, method: 'cheque', received_at: '2026-10-12T09:00:00Z', applies_to_job_id: null, collected_by_worker_id: 'w-dave', collected_by_name: 'Dave', handed_over_at: null },
      { id: 'gone', tenant_id: T, status: 'active', customer_id: 'c2', amount: 40, method: 'cash', received_at: '2026-10-11T09:00:00Z', applies_to_job_id: null, collected_by_worker_id: null, collected_by_name: 'Sam (left)', handed_over_at: null },
      { id: 'own', tenant_id: T, status: 'active', customer_id: 'c1', amount: 99, method: 'cash', received_at: '2026-10-12T09:00:00Z', applies_to_job_id: null, collected_by_worker_id: null, collected_by_name: null, handed_over_at: null },
      { id: 'done', tenant_id: T, status: 'active', customer_id: 'c1', amount: 30, method: 'cash', received_at: '2026-10-01T09:00:00Z', applies_to_job_id: null, collected_by_worker_id: 'w-dave', collected_by_name: 'Dave', handed_over_at: '2026-10-03T12:00:00.000Z' },
      { id: 'void', tenant_id: T, status: 'void', customer_id: 'c1', amount: 77, method: 'cash', received_at: '2026-10-12T09:00:00Z', applies_to_job_id: null, collected_by_worker_id: 'w-dave', collected_by_name: 'Dave', handed_over_at: null },
      { id: 'other', tenant_id: 'other', status: 'active', customer_id: 'c1', amount: 55, method: 'cash', received_at: '2026-10-12T09:00:00Z', applies_to_job_id: null, collected_by_worker_id: 'w-x', collected_by_name: 'X', handed_over_at: null },
    ],
  });
  // The real SQL functions, in miniature (the migrations are tested separately in a real Postgres).
  db.rpcHandlers.mark_payments_handed_over = (a) => {
    let n = 0;
    for (const p of db.rows('payments')) {
      if (p.tenant_id === a.p_tenant_id && (a.p_payment_ids as string[]).includes(p.id as string) && p.status === 'active' && !p.handed_over_at && (p.collected_by_worker_id || p.collected_by_name)) {
        p.handed_over_at = (a.p_at as string) ?? '2026-10-13T08:00:00.000Z';
        n += 1;
      }
    }
    return n;
  };
  db.rpcHandlers.mark_worker_cash_handed_over = (a) => {
    let n = 0;
    for (const p of db.rows('payments')) {
      if (p.tenant_id === a.p_tenant_id && p.collected_by_worker_id === a.p_worker_id && p.status === 'active' && !p.handed_over_at) {
        p.handed_over_at = (a.p_at as string) ?? '2026-10-13T08:00:00.000Z';
        n += 1;
      }
    }
    return n;
  };
  db.rpcHandlers.unmark_payment_handed_over = (a) => {
    const p = db.rows('payments').find((x) => x.id === a.p_payment_id && x.tenant_id === a.p_tenant_id && x.handed_over_at);
    if (!p) return false;
    p.handed_over_at = null;
    return true;
  };
  return db;
}

let db: FakeDb;
beforeEach(() => {
  db = seed();
});
const handed = (id: string) => db.rows('payments').find((p) => p.id === id)!.handed_over_at;

describe('listHeldCash', () => {
  it('groups what each person holds, oldest first, with ages; leaves out the owner’s cash, handed-over, voided and other businesses’', async () => {
    const groups = await listHeldCash(db.client, T, TODAY);
    expect(groups.map((g) => g.name)).toEqual(['Dave', 'Sam (left)']);
    const dave = groups[0]!;
    expect(dave).toMatchObject({ workerId: 'w-dave', total: 25.5, count: 2, oldestAgeDays: 3 });
    expect(dave.items.map((i) => i.paymentId)).toEqual(['a', 'b']);
    expect(dave.items[0]).toMatchObject({ customerName: 'Mrs Patel', visitTitle: 'Windows', method: 'cash', ageDays: 3 });
    expect(groups[1]).toMatchObject({ workerId: null, total: 40, oldestAgeDays: 2 });
    expect(groups.flatMap((g) => g.items.map((i) => i.paymentId))).not.toEqual(expect.arrayContaining(['own', 'done', 'void', 'other']));
  });
});

describe('markHandedOver', () => {
  it('ticks some payments and leaves the rest held', async () => {
    expect(await markHandedOver(db.client, { ...base, paymentIds: ['a'] })).toEqual({ ok: true, changed: 1 });
    expect(handed('a')).not.toBeNull();
    expect(handed('b')).toBeNull();
  });

  it('ticking the same payment again changes nothing', async () => {
    await markHandedOver(db.client, { ...base, paymentIds: ['a'] });
    expect(await markHandedOver(db.client, { ...base, paymentIds: ['a'] })).toEqual({ ok: true, changed: 0 });
  });

  it('skips the owner’s own cash, a voided payment and another business’s, and reports the real count', async () => {
    const r = await markHandedOver(db.client, { ...base, paymentIds: ['a', 'own', 'void', 'other'] });
    expect(r).toEqual({ ok: true, changed: 1 });
    expect(handed('own')).toBeNull();
    expect(handed('other')).toBeNull();
  });

  it('can be dated to a day the cash was actually handed over, but not before it was taken or in the future', async () => {
    expect(await markHandedOver(db.client, { ...base, paymentIds: ['a'], handedOverOn: '2026-10-12' })).toEqual({ ok: true, changed: 1 });
    expect(handed('a')).toBe('2026-10-12T12:00:00.000Z');
    expect(await markHandedOver(db.client, { ...base, paymentIds: ['b'], handedOverOn: '2026-10-11' })).toEqual({ ok: false, error: 'That date is before the cash was taken.' });
    expect(await markHandedOver(db.client, { ...base, paymentIds: ['b'], handedOverOn: '2026-10-14' })).toEqual({ ok: false, error: 'That date is in the future.' });
    expect(handed('b')).toBeNull();
  });

  it('wants between 1 and 200 payments', async () => {
    expect((await markHandedOver(db.client, { ...base, paymentIds: [] })).ok).toBe(false);
    expect((await markHandedOver(db.client, { ...base, paymentIds: Array.from({ length: 201 }, (_, i) => `id-${i}`) })).ok).toBe(false);
  });
});

describe('clearWorkerCash', () => {
  it('ticks everything one person holds at that moment, and nobody else’s', async () => {
    expect(await clearWorkerCash(db.client, { ...base, workerId: 'w-dave' })).toEqual({ ok: true, changed: 2 });
    expect(handed('a')).not.toBeNull();
    expect(handed('b')).not.toBeNull();
    expect(handed('gone')).toBeNull();
    expect((await listHeldCash(db.client, T, TODAY)).map((g) => g.name)).toEqual(['Sam (left)']);
  });

  it('a payment recorded after the clear is not part of it', async () => {
    await clearWorkerCash(db.client, { ...base, workerId: 'w-dave' });
    db.rows('payments').push({ id: 'late', tenant_id: T, status: 'active', customer_id: 'c1', amount: 10, method: 'cash', received_at: '2026-10-13T10:00:00Z', collected_by_worker_id: 'w-dave', collected_by_name: 'Dave', handed_over_at: null });
    expect(handed('late')).toBeNull();
  });
});

describe('undoHandOver and the recent list', () => {
  it('puts a ticked payment back to held', async () => {
    await markHandedOver(db.client, { ...base, paymentIds: ['a'] });
    expect(await undoHandOver(db.client, { tenantId: T, paymentId: 'a' })).toEqual({ ok: true });
    expect(handed('a')).toBeNull();
  });

  it('is refused after 14 days, and for something that was never ticked', async () => {
    expect(await undoHandOver(db.client, { tenantId: T, paymentId: 'done', now: new Date('2026-10-20T00:00:00Z') })).toEqual({ ok: false, error: 'Too old to undo.' });
    expect(await undoHandOver(db.client, { tenantId: T, paymentId: 'b' })).toEqual({ ok: false, error: 'Not found.' });
    expect(await undoHandOver(db.client, { tenantId: 'other', paymentId: 'done', now: new Date('2026-10-04T00:00:00Z') })).toEqual({ ok: false, error: 'Not found.' });
  });

  it('lists the latest hand-ins with who held them', async () => {
    expect(await recentHandIns(db.client, T)).toEqual([
      { paymentId: 'done', collectorName: 'Dave', customerName: 'Mrs Patel', amount: 30, handedOverAt: '2026-10-03T12:00:00.000Z' },
    ]);
  });
});
