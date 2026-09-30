import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const T1 = '11111111-1111-1111-1111-111111111111';
const T2 = '22222222-2222-2222-2222-222222222222';
const T3 = '33333333-3333-3333-3333-333333333333';
const NOW = new Date('2026-10-01T17:00:00.000Z');

const collectForCustomer = vi.fn();
const resumeCollection = vi.fn();
const processGoCardlessEvents = vi.fn();
const refreshCollection = vi.fn();
const refreshVerification = vi.fn();
const listRoundsTenantIds = vi.fn();
const pushes: { tenantId: string; title: string; body: string; data: Record<string, unknown> }[] = [];

vi.mock('@/lib/direct-debit/collect', () => ({
  collectForCustomer: (...a: unknown[]) => collectForCustomer(...a),
  resumeCollection: (...a: unknown[]) => resumeCollection(...a),
}));
vi.mock('@/lib/direct-debit/webhook', () => ({
  processGoCardlessEvents: (...a: unknown[]) => processGoCardlessEvents(...a),
  refreshCollection: (...a: unknown[]) => refreshCollection(...a),
}));
vi.mock('@/lib/gocardless/connection', () => ({
  refreshVerification: (...a: unknown[]) => refreshVerification(...a),
}));
vi.mock('@/lib/messaging/rounds-tenants', () => ({
  listRoundsTenantIds: () => listRoundsTenantIds(),
}));
vi.mock('@/lib/push/owner-push', () => ({
  sendOrHoldOwnerPush: async (_a: unknown, tenantId: string, p: { title: string; body: string; data: Record<string, unknown> }) => {
    pushes.push({ tenantId, ...p });
    return 'sent';
  },
}));

import { runEveningCollections, runMorningCollectionSweep } from '@/lib/direct-debit/run-collections';

type Row = Record<string, unknown>;
let db: Record<string, Row[]>;

function valueAt(row: Row, column: string): unknown {
  let cur: unknown = row;
  for (const part of column.split(/->>|->/)) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Row)[part];
  }
  return cur;
}

function fakeAdmin(failTable?: string): SupabaseClient {
  const from = (table: string) => {
    db[table] ??= [];
    const filters: ((r: Row) => boolean)[] = [];
    let max = Infinity;
    const run = (single: boolean) => {
      if (table === failTable) return { data: null, error: { code: 'XX000' } };
      const hit = db[table].filter((r) => filters.every((f) => f(r))).slice(0, max);
      return { data: single ? (hit[0] ?? null) : hit, error: null };
    };
    const b = {
      select: () => b,
      eq: (c: string, v: unknown) => (filters.push((r) => valueAt(r, c) === v), b),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(valueAt(r, c))), b),
      lte: (c: string, v: string) => (filters.push((r) => valueAt(r, c) != null && String(valueAt(r, c)) <= v), b),
      gte: (c: string, v: string) => (filters.push((r) => valueAt(r, c) != null && String(valueAt(r, c)) >= v), b),
      order: () => b,
      limit: (n: number) => ((max = n), b),
      maybeSingle: async () => run(true),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run(false)).then(res, rej),
    };
    return b;
  };
  return { from } as unknown as SupabaseClient;
}

const on = { status: 'connected', verification_status: 'successful' };

beforeEach(() => {
  db = {
    gocardless_connections: [
      { tenant_id: T1, status: 'connected' },
      { tenant_id: T2, status: 'connected' },
      { tenant_id: T3, status: 'disconnected' },
      { tenant_id: 'pro-tenant', status: 'connected' },
    ],
    customer_direct_debits: [
      { tenant_id: T1, customer_id: 'c1', status: 'active' },
      { tenant_id: T1, customer_id: 'c2', status: 'pending' },
      { tenant_id: T1, customer_id: 'c3', status: 'cancelled' },
      { tenant_id: T2, customer_id: 'c4', status: 'active' },
    ],
    customers: [
      { id: 'c1', tenant_id: T1, name: 'Jane Wright' },
      { id: 'c2', tenant_id: T1, name: 'Bob Hill' },
      { id: 'c4', tenant_id: T2, name: 'Sue Ray' },
    ],
    owner_pushes: [],
    direct_debit_collections: [],
  };
  pushes.length = 0;
  for (const m of [collectForCustomer, resumeCollection, processGoCardlessEvents, refreshCollection, refreshVerification, listRoundsTenantIds]) {
    m.mockReset();
  }
  listRoundsTenantIds.mockResolvedValue([T1, T2, T3]);
  refreshVerification.mockResolvedValue(on);
  collectForCustomer.mockResolvedValue({ kind: 'created', collectionId: 'x', amount: 15 });
  processGoCardlessEvents.mockResolvedValue({ processed: 0, failed: 0 });
});

describe('runEveningCollections', () => {
  it('collects for each pending/active Direct Debit customer of connected Rounds businesses only', async () => {
    const out = await runEveningCollections(fakeAdmin(), { now: NOW });
    const calls = collectForCustomer.mock.calls.map((c) => [c[1].tenantId, c[1].customerId, c[1].createdBy]);
    expect(calls).toEqual([
      [T1, 'c1', 'cron'],
      [T1, 'c2', 'cron'],
      [T2, 'c4', 'cron'],
    ]);
    expect(out).toMatchObject({ tenants: 2, customers: 3, created: 3, amount: 45, errors: 0, stoppedEarly: false });
    expect(refreshVerification).toHaveBeenCalledTimes(2);
    expect(refreshVerification).toHaveBeenCalledWith(expect.anything(), T1, expect.objectContaining({ force: true }));
  });

  it('skips a business whose verification is not successful, counting nothing', async () => {
    refreshVerification.mockImplementation(async (_a: unknown, tenantId: string) =>
      tenantId === T1 ? { status: 'connected', verification_status: 'action_required' } : on,
    );
    const out = await runEveningCollections(fakeAdmin(), { now: NOW });
    expect(collectForCustomer.mock.calls.map((c) => c[1].tenantId)).toEqual([T2]);
    expect(out).toMatchObject({ tenants: 1, customers: 1 });
  });

  it('a business that went disconnected while refreshing is skipped', async () => {
    refreshVerification.mockResolvedValueOnce({ status: 'disconnected', verification_status: 'successful' });
    await runEveningCollections(fakeAdmin(), { now: NOW });
    expect(collectForCustomer.mock.calls.map((c) => c[1].tenantId)).toEqual([T2]);
  });

  it('counts skipped and errors, and one customer throwing does not stop the rest', async () => {
    collectForCustomer
      .mockResolvedValueOnce({ kind: 'skipped', reason: 'nothing_to_collect' })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ kind: 'error', collectionId: null, message: 'GoCardless said no' });
    const out = await runEveningCollections(fakeAdmin(), { now: NOW });
    expect(out).toMatchObject({ skipped: 1, errors: 2, created: 0, customers: 3 });
  });

  it("one business throwing doesn't stop the others", async () => {
    refreshVerification.mockRejectedValueOnce(new Error('db down'));
    const out = await runEveningCollections(fakeAdmin(), { now: NOW });
    expect(out.errors).toBe(1);
    expect(collectForCustomer.mock.calls.map((c) => c[1].tenantId)).toEqual([T2]);
  });

  it('too large → one push, worded as the card says', async () => {
    collectForCustomer.mockImplementation(async (_a: unknown, p: { customerId: string }) =>
      p.customerId === 'c1' ? { kind: 'too_large', amount: 1250 } : { kind: 'skipped', reason: 'busy' },
    );
    const out = await runEveningCollections(fakeAdmin(), { now: NOW });
    expect(out.tooLarge).toBe(1);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({
      title: 'Direct Debit not collected',
      body: 'Jane Wright owes £1,250 — over the £1,000 Direct Debit limit. Ask them to pay by card or transfer.',
    });
    expect(pushes[0].data).toMatchObject({ type: 'dd_attention', customerId: 'c1' });
  });

  it('another app → one push with the detail; not repeated for a warning already held today', async () => {
    collectForCustomer.mockImplementation(async (_a: unknown, p: { customerId: string }) =>
      p.customerId === 'c1' ? { kind: 'other_app', detail: '1 subscription' } : { kind: 'skipped', reason: 'busy' },
    );
    await runEveningCollections(fakeAdmin(), { now: NOW });
    expect(pushes[0]).toMatchObject({ title: 'Not collected — another app' });
    expect(pushes[0].body).toBe(
      "Jane Wright: another app is still collecting from their Direct Debit (1 subscription). Switch it off; WorkWise will collect once it's clear.",
    );

    db.owner_pushes = [
      { tenant_id: T1, kind: 'dd_attention', title: 'Not collected — another app', data: { customerId: 'c1' }, created_at: '2026-10-01T16:00:00.000Z' },
    ];
    pushes.length = 0;
    await runEveningCollections(fakeAdmin(), { now: NOW });
    expect(pushes).toHaveLength(0);
  });

  it('never warns twice for the same customer in one run', async () => {
    db.customer_direct_debits.push({ tenant_id: T1, customer_id: 'c1', status: 'pending' });
    collectForCustomer.mockResolvedValue({ kind: 'too_large', amount: 2000 });
    await runEveningCollections(fakeAdmin(), { now: NOW });
    expect(pushes.filter((p) => p.data.customerId === 'c1')).toHaveLength(1);
  });

  it('stops starting new businesses after the deadline', async () => {
    const out = await runEveningCollections(fakeAdmin(), { now: NOW, deadlineMs: -1 });
    expect(out.stoppedEarly).toBe(true);
    expect(collectForCustomer).not.toHaveBeenCalled();
  });

  it("doesn't collect blind when the business list can't be read", async () => {
    await expect(runEveningCollections(fakeAdmin('gocardless_connections'), { now: NOW })).rejects.toThrow();
    expect(collectForCustomer).not.toHaveBeenCalled();
  });
});

describe('runMorningCollectionSweep', () => {
  it('replays events, resumes young creating rows, refreshes old processing rows and every verification', async () => {
    db.direct_debit_collections = [
      { id: 'young', status: 'creating', created_at: '2026-10-01T05:00:00.000Z' },
      { id: 'fresh', status: 'creating', created_at: '2026-10-01T06:50:00.000Z' },
      { id: 'old-proc', status: 'processing', submitted_at: '2026-09-20T10:00:00.000Z' },
      { id: 'new-proc', status: 'processing', submitted_at: '2026-09-30T10:00:00.000Z' },
      { id: 'done', status: 'succeeded', submitted_at: '2026-09-01T10:00:00.000Z' },
    ];
    processGoCardlessEvents.mockResolvedValue({ processed: 3, failed: 1 });
    resumeCollection.mockResolvedValue({ kind: 'created', collectionId: 'young', amount: 15 });
    refreshCollection.mockResolvedValue('updated');
    const now = new Date('2026-10-01T07:00:00.000Z');
    const out = await runMorningCollectionSweep(fakeAdmin(), now);

    expect(processGoCardlessEvents).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ olderThanMs: 120_000 }));
    expect(resumeCollection.mock.calls.map((c) => c[1])).toEqual(['young']);
    expect(refreshCollection.mock.calls.map((c) => c[1])).toEqual(['old-proc']);
    expect(refreshVerification).toHaveBeenCalledTimes(3);
    expect(out).toEqual({ eventsProcessed: 3, eventsFailed: 1, resumed: 1, errored: 0, refreshed: 1, verificationsRefreshed: 3 });
  });

  it('counts collections that could not be resumed as errored', async () => {
    db.direct_debit_collections = [{ id: 'old', status: 'creating', created_at: '2026-09-29T05:00:00.000Z' }];
    resumeCollection.mockResolvedValue({ kind: 'error', collectionId: 'old', message: 'Never reached GoCardless' });
    const out = await runMorningCollectionSweep(fakeAdmin(), new Date('2026-10-01T07:00:00.000Z'));
    expect(out.errored).toBe(1);
  });

  it('each part fails on its own without stopping the rest and never creates a collection', async () => {
    processGoCardlessEvents.mockRejectedValue(new Error('events down'));
    db.direct_debit_collections = [{ id: 'a', status: 'creating', created_at: '2026-10-01T05:00:00.000Z' }];
    resumeCollection.mockRejectedValue(new Error('resume down'));
    refreshVerification.mockRejectedValueOnce(new Error('gc down'));
    const out = await runMorningCollectionSweep(fakeAdmin(), new Date('2026-10-01T07:00:00.000Z'));
    expect(out).toMatchObject({ eventsProcessed: 0, errored: 1, verificationsRefreshed: 2 });
    expect(collectForCustomer).not.toHaveBeenCalled();
  });
});
