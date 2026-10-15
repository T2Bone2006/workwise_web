import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const sendOrHoldOwnerPush = vi.fn();
vi.mock('@/lib/push/owner-push', () => ({ sendOrHoldOwnerPush: (...a: unknown[]) => sendOrHoldOwnerPush(...a) }));

import { nudgeDays, nudgeText, runCashNudge, shouldNudge } from '@/lib/team/cash-nudge';
import { fakeDb, type FakeDb, type Row } from './fake-db';

describe('when to nudge', () => {
  it('first on the day the oldest cash is 3 days old, then every third day', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((age) => shouldNudge(age, 3))).toEqual([false, false, false, true, false, false, true, false, false, true]);
  });
  it('follows a different threshold', () => {
    expect(shouldNudge(5, 5)).toBe(true);
    expect(shouldNudge(4, 5)).toBe(false);
    expect(shouldNudge(8, 5)).toBe(true);
  });
  it('reads CASH_NUDGE_DAYS as a whole number 1–30, else 3', () => {
    expect(nudgeDays('5')).toBe(5);
    expect(nudgeDays(undefined)).toBe(3);
    expect(nudgeDays('0')).toBe(3);
    expect(nudgeDays('31')).toBe(3);
    expect(nudgeDays('abc')).toBe(3);
    expect(nudgeDays('2.5')).toBe(3);
  });
});

describe('what the push says', () => {
  it('one person: "Dave has had £140 for 3 days."', () => {
    expect(nudgeText([{ name: 'Dave', total: 140, oldestAgeDays: 3 }])).toEqual({ title: 'Cash to collect', body: 'Dave has had £140 for 3 days.' });
    expect(nudgeText([{ name: 'Dave', total: 45.5, oldestAgeDays: 1 }]).body).toBe('Dave has had £45.50 for 1 day.');
  });
  it('several people in one push', () => {
    expect(nudgeText([{ name: 'Dave', total: 140, oldestAgeDays: 3 }, { name: 'Lee', total: 60, oldestAgeDays: 4 }]).body).toBe('Dave £140 (3 days), Lee £60 (4 days)');
  });
  it('keeps to 200 characters by saying "and N more"', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `Person number ${i}`, total: 100, oldestAgeDays: 3 }));
    const text = nudgeText(many);
    expect(text.body.length).toBeLessThanOrEqual(200);
    expect(text.body).toMatch(/and \d+ more$/);
  });
});

describe('runCashNudge', () => {
  const NOW = new Date('2026-10-16T08:00:00Z');
  const held = (id: string, tenant: string, receivedAt: string, over: Row = {}): Row => ({
    id, tenant_id: tenant, status: 'active', amount: 20, method: 'cash', customer_id: null, applies_to_job_id: null,
    received_at: receivedAt, collected_by_worker_id: 'w-dave', collected_by_name: 'Dave', handed_over_at: null, ...over,
  });
  let db: FakeDb;

  beforeEach(() => {
    sendOrHoldOwnerPush.mockReset();
    sendOrHoldOwnerPush.mockResolvedValue('sent');
    db = fakeDb({ team_people: [{ id: 'p', tenant_id: 't1', kind: 'lead', worker_id: 'w-dave', name: 'Dave' }] });
  });

  it('pushes the owner once when cash is 3 days old, naming who holds it and how much', async () => {
    db.rows('payments').push(held('a', 't1', '2026-10-13T09:00:00Z'), held('b', 't1', '2026-10-14T09:00:00Z', { amount: 25.5 }));
    const tally = await runCashNudge(NOW, db.client);
    expect(tally).toEqual({ checked: 1, sent: 1, held: 0, skipped: 0, errors: 0 });
    expect(sendOrHoldOwnerPush).toHaveBeenCalledOnce();
    const [, tenantId, push] = sendOrHoldOwnerPush.mock.calls[0];
    expect(tenantId).toBe('t1');
    expect(push).toMatchObject({ kind: 'cash_handin', title: 'Cash to collect', body: 'Dave has had £45.50 for 3 days.', data: { type: 'cash_handin', amount: 45.5 } });
  });

  it('says nothing at 2 days, at 4 days, or for cash already handed over or nobody’s', async () => {
    db.rows('payments').push(held('young', 't1', '2026-10-14T09:00:00Z'));
    expect((await runCashNudge(NOW, db.client)).sent).toBe(0);
    db.rows('payments').length = 0;
    db.rows('payments').push(held('mid', 't1', '2026-10-12T09:00:00Z'));
    expect((await runCashNudge(NOW, db.client)).sent).toBe(0); // 4 days: not a nudge day
    db.rows('payments').length = 0;
    db.rows('payments').push(held('done', 't1', '2026-10-01T09:00:00Z', { handed_over_at: '2026-10-02T09:00:00Z' }), held('own', 't1', '2026-10-01T09:00:00Z', { collected_by_worker_id: null, collected_by_name: null }));
    expect(await runCashNudge(NOW, db.client)).toMatchObject({ checked: 0, sent: 0 });
    expect(sendOrHoldOwnerPush).not.toHaveBeenCalled();
  });

  it('one combined push for a business with several people over the line; one push per business', async () => {
    db.rows('team_people').push({ id: 'p2', tenant_id: 't1', kind: 'lead', worker_id: 'w-lee', name: 'Lee' });
    db.rows('payments').push(
      held('a', 't1', '2026-10-13T09:00:00Z'),
      held('b', 't1', '2026-10-13T09:00:00Z', { collected_by_worker_id: 'w-lee', collected_by_name: 'Lee', amount: 60 }),
      held('c', 't2', '2026-10-13T09:00:00Z'),
    );
    const tally = await runCashNudge(NOW, db.client);
    expect(tally.checked).toBe(2);
    expect(sendOrHoldOwnerPush).toHaveBeenCalledTimes(2);
    const t1 = sendOrHoldOwnerPush.mock.calls.find((c) => c[1] === 't1')![2];
    expect(t1.body).toContain('Dave £20');
    expect(t1.body).toContain('Lee £60');
  });

  it('keeps nudging about a removed lead’s cash, using the name saved on the payment', async () => {
    db.rows('payments').push(held('gone', 't3', '2026-10-13T09:00:00Z', { collected_by_worker_id: null, collected_by_name: 'Sam (left)' }));
    await runCashNudge(NOW, db.client);
    expect(sendOrHoldOwnerPush.mock.calls[0][2].body).toBe('Sam (left) has had £20 for 3 days.');
  });

  it('counts held pushes, businesses with no phone and failures, and one failure does not stop the rest', async () => {
    db.rows('payments').push(held('a', 't1', '2026-10-13T09:00:00Z'), held('b', 't2', '2026-10-13T09:00:00Z'), held('c', 't3', '2026-10-13T09:00:00Z'), held('d', 't4', '2026-10-13T09:00:00Z'));
    sendOrHoldOwnerPush.mockResolvedValueOnce('held').mockResolvedValueOnce('no_token').mockResolvedValueOnce('failed').mockRejectedValueOnce(new Error('boom'));
    expect(await runCashNudge(NOW, db.client)).toEqual({ checked: 4, sent: 0, held: 1, skipped: 1, errors: 2 });
  });

  it('does nothing before the migration is pasted', async () => {
    const original = db.from.bind(db);
    db.from = ((table: string) => {
      const q = original(table) as unknown as Record<string, unknown>;
      if (table === 'payments') {
        const chain: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'is', 'or', 'lte', 'order']) chain[m] = () => chain;
        chain.limit = () => Promise.resolve({ data: null, error: { code: '42703', message: 'column does not exist' } });
        return chain;
      }
      return q;
    }) as never;
    expect(await runCashNudge(NOW, db.client)).toEqual({ checked: 0, sent: 0, held: 0, skipped: 0, errors: 0 });
  });
});
