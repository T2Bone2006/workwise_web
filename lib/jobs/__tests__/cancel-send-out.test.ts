import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cancelJobsInDb } from '@/lib/jobs/cancel-jobs';
import { sendOutJobsInDb } from '@/lib/jobs/send-out-jobs';

const notify = vi.fn<(args: unknown) => Promise<void>>(async () => {});
const notifyCancelled = vi.fn<(args: unknown) => Promise<void>>(async () => {});
vi.mock('@/lib/jobs/notify-sent-jobs', () => ({
  notifyWorkersOfSentJobs: (a: unknown) => notify(a),
  notifyWorkersOfCancelledJobs: (a: unknown) => notifyCancelled(a),
}));

type Call = { table: string; op: 'select' | 'update' | 'insert'; payload?: unknown; filters: Array<[string, unknown]> };

/** Records every query and answers each update/select from a queue, whatever the filters. */
function recorder(answers: { select?: unknown[]; updates?: unknown[][] }) {
  const calls: Call[] = [];
  const updates = [...(answers.updates ?? [])];
  const db = {
    from(table: string) {
      const call: Call = { table, op: 'select', filters: [] };
      const q: Record<string, unknown> = {};
      for (const m of ['eq', 'in', 'not']) q[m] = (...a: unknown[]) => (call.filters.push([m, a]), q);
      q.select = () => q;
      q.update = (payload: unknown) => ((call.op = 'update'), (call.payload = payload), q);
      q.insert = (payload: unknown) => ((call.op = 'insert'), (call.payload = payload), calls.push(call), Promise.resolve({ error: null }));
      q.then = (resolve: (v: unknown) => unknown) => {
        calls.push(call);
        const data = call.op === 'update' ? (updates.shift() ?? []) : (answers.select ?? []);
        return resolve({ data, error: null });
      };
      return q;
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

describe('cancelJobsInDb', () => {
  beforeEach(() => notifyCancelled.mockClear());

  it('cancels each starting status in one update, then writes one history row per job', async () => {
    const { db, calls } = recorder({ updates: [[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }]] });
    const r = await cancelJobsInDb(db, {
      tenantId: 't1',
      userId: 'u1',
      jobs: [{ id: 'a', status: 'pending' }, { id: 'b', status: 'pending' }, { id: 'c', status: 'assigned' }],
      cancelledAt: '2026-11-04T16:46:00.000Z',
      via: 'assistant',
    });
    expect(r.cancelledIds).toEqual(['a', 'b', 'c']);
    expect(calls.filter((c) => c.op === 'update')).toHaveLength(2);
    const history = calls.find((c) => c.table === 'job_status_history')!.payload as Array<Record<string, unknown>>;
    expect(history.map((h) => [h.job_id, h.from_status])).toEqual([['a', 'pending'], ['b', 'pending'], ['c', 'assigned']]);
    expect(history[0]).toMatchObject({ to_status: 'cancelled', created_at: '2026-11-04T16:46:00.000Z', changed_by_user_id: 'u1', notes: 'Cancelled' });
    expect(history[0]!.metadata).toMatchObject({ cancelled_at: '2026-11-04T16:46:00.000Z', via: 'assistant' });
  });

  it('tells the worker only for jobs they already had (sent or in progress), not ones not sent yet', async () => {
    const row = (id: string) => ({ id, reference_number: `RS-${id}`, assigned_worker_id: 'w1', postcode: 'BS1', scheduled_date: '2026-11-10', scheduled_time: '09:00:00', customers: { name: 'Acme' } });
    const { db } = recorder({ select: [row('c'), row('d')], updates: [[{ id: 'a' }], [{ id: 'c' }], [{ id: 'd' }]] });
    await cancelJobsInDb(db, {
      tenantId: 't1',
      userId: 'u1',
      jobs: [{ id: 'a', status: 'pending_send' }, { id: 'c', status: 'assigned' }, { id: 'd', status: 'in_progress' }],
      cancelledAt: '2026-11-04T16:46:00.000Z',
    });
    expect(notifyCancelled).toHaveBeenCalledTimes(1);
    expect((notifyCancelled.mock.calls[0] as unknown as [{ jobs: Array<{ id: string }> }])[0].jobs.map((j) => j.id)).toEqual(['c', 'd']);
  });

  it('tells nobody when no job had gone out to a worker', async () => {
    const { db } = recorder({ updates: [[{ id: 'a' }]] });
    await cancelJobsInDb(db, { tenantId: 't1', userId: 'u1', jobs: [{ id: 'a', status: 'pending' }], cancelledAt: '2026-11-04T16:46:00.000Z' });
    expect(notifyCancelled).not.toHaveBeenCalled();
  });

  it('leaves out a job that changed (the update did not return it) and writes nothing for it', async () => {
    const { db, calls } = recorder({ updates: [[{ id: 'a' }]] });
    const r = await cancelJobsInDb(db, { tenantId: 't1', userId: null, jobs: [{ id: 'a', status: 'pending' }, { id: 'b', status: 'pending' }], cancelledAt: '2026-11-04T16:46:00.000Z' });
    expect(r.cancelledIds).toEqual(['a']);
    expect((calls.find((c) => c.table === 'job_status_history')!.payload as unknown[]).length).toBe(1);
  });

  it('writes no history when nothing was cancelled', async () => {
    const { db, calls } = recorder({ updates: [[]] });
    const r = await cancelJobsInDb(db, { tenantId: 't1', userId: null, jobs: [{ id: 'a', status: 'pending' }], cancelledAt: '2026-11-04T16:46:00.000Z' });
    expect(r.cancelledIds).toEqual([]);
    expect(calls.some((c) => c.table === 'job_status_history')).toBe(false);
  });
});

describe('sendOutJobsInDb', () => {
  const row = (id: string) => ({ id, reference_number: `RS-${id}`, assigned_worker_id: 'w1', postcode: 'BS1', scheduled_date: '2026-11-10', scheduled_time: '09:00:00', customers: { name: 'Acme' } });

  beforeEach(() => notify.mockClear());

  it('sends the ready jobs, records it once per job and tells the workers once', async () => {
    const { db, calls } = recorder({ select: [row('a'), row('b')], updates: [[{ id: 'a' }, { id: 'b' }]] });
    const r = await sendOutJobsInDb(db, { tenantId: 't1', userId: 'u1', jobIds: ['a', 'b'], via: 'assistant' });
    expect(r).toEqual({ ok: true, sent: 2, jobIds: ['a', 'b'] });
    expect(calls.filter((c) => c.op === 'update')).toHaveLength(1);
    expect((calls.find((c) => c.table === 'job_status_history')!.payload as unknown[]).length).toBe(2);
    expect(notify).toHaveBeenCalledTimes(1);
    expect((notify.mock.calls[0] as unknown as [{ jobs: unknown[] }])[0].jobs).toHaveLength(2);
  });

  it('only tells workers about jobs that really changed', async () => {
    const { db } = recorder({ select: [row('a'), row('b')], updates: [[{ id: 'a' }]] });
    const r = await sendOutJobsInDb(db, { tenantId: 't1', userId: 'u1' });
    expect(r).toEqual({ ok: true, sent: 1, jobIds: ['a'] });
    expect((notify.mock.calls[0] as unknown as [{ jobs: Array<{ id: string }> }])[0].jobs.map((j) => j.id)).toEqual(['a']);
  });

  it('sends a long list in chunks so the request address stays short', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `j${i}`);
    const { db, calls } = recorder({ select: ids.map(row), updates: [ids.slice(0, 100).map((id) => ({ id })), ids.slice(100).map((id) => ({ id }))] });
    const r = await sendOutJobsInDb(db, { tenantId: 't1', userId: 'u1' });
    expect(r.ok && r.sent).toBe(150);
    expect(calls.filter((c) => c.op === 'update')).toHaveLength(2);
  });

  it('says so when nothing is ready, and does not notify anyone', async () => {
    const { db } = recorder({ select: [] });
    expect(await sendOutJobsInDb(db, { tenantId: 't1', userId: 'u1', jobIds: ['a'] })).toEqual({ ok: false, error: 'No jobs ready to send.' });
    expect(await sendOutJobsInDb(db, { tenantId: 't1', userId: 'u1', jobIds: [] })).toEqual({ ok: false, error: 'No jobs selected.' });
    expect(notify).not.toHaveBeenCalled();
  });
});
