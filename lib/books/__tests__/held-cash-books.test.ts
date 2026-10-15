import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { isMissingHeldColumn, readMoneyInPayments, sumHeldCash } from '@/lib/books/money-in';
import { loadBooksSummary } from '@/lib/books/summary';
import { getCashTakenOn } from '@/lib/data/payments/history';
import { fakeDb, type Row } from '../../team/__tests__/fake-db';

const T = 't1';
const OCT = { kind: 'month', year: 2026, month: 10 } as const;
const SEP = { kind: 'month', year: 2026, month: 9 } as const;

const pay = (id: string, over: Row = {}): Row => ({
  id, tenant_id: T, status: 'active', amount: 20, refunded_amount: 0, method: 'cash',
  received_at: '2026-10-03T09:00:00Z', collected_by_worker_id: null, collected_by_name: null, handed_over_at: null, ...over,
});
const dave = { collected_by_worker_id: 'w-dave', collected_by_name: 'Dave' };

function mixed() {
  return fakeDb({
    payments: [
      pay('owner-cash'),                                                                // counts 3 Oct
      pay('card', { method: 'card', amount: 15, received_at: '2026-10-04T09:00:00Z' }), // counts 4 Oct
      pay('dave-handed', { ...dave, amount: 30, received_at: '2026-10-03T10:00:00Z', handed_over_at: '2026-10-05T12:00:00Z' }), // counts 5 Oct
      pay('dave-held', { ...dave, amount: 50, received_at: '2026-10-04T10:00:00Z' }),   // not yet
      pay('dave-void', { ...dave, amount: 60, status: 'void', handed_over_at: '2026-10-05T12:00:00Z' }),
      pay('other-biz', { tenant_id: 'other', amount: 99 }),
    ],
  });
}

describe('money in with held team cash', () => {
  it('counts what the owner has, leaves out cash still held, voided payments and other businesses', async () => {
    const s = await loadBooksSummary(mixed().client, { tenantId: T, period: OCT });
    expect(s.moneyIn).toBe(65); // 20 + 15 + 30
    expect(s.paymentsCount).toBe(3);
    expect(s.moneyInByMethod).toEqual([{ method: 'cash', amount: 50 }, { method: 'card', amount: 15 }]);
  });

  it('dates handed-over cash on the day it was handed over, not the day it was taken', async () => {
    const db = fakeDb({
      payments: [pay('late', { ...dave, amount: 40, received_at: '2026-09-30T10:00:00Z', handed_over_at: '2026-10-02T12:00:00Z' })],
    });
    expect((await loadBooksSummary(db.client, { tenantId: T, period: SEP })).moneyIn).toBe(0);
    expect((await loadBooksSummary(db.client, { tenantId: T, period: OCT })).moneyIn).toBe(40);
  });

  it('cash taken in one month and handed over the next never changes the earlier month afterwards', async () => {
    const db = fakeDb({ payments: [pay('p', { ...dave, amount: 40, received_at: '2026-09-30T10:00:00Z' })] });
    expect((await loadBooksSummary(db.client, { tenantId: T, period: SEP })).moneyIn).toBe(0);
    db.rows('payments')[0].handed_over_at = '2026-10-02T12:00:00Z';
    expect((await loadBooksSummary(db.client, { tenantId: T, period: SEP })).moneyIn).toBe(0);
    expect((await loadBooksSummary(db.client, { tenantId: T, period: OCT })).moneyIn).toBe(40);
  });

  it('nets a refund in the month the cash counts', async () => {
    const db = fakeDb({ payments: [pay('p', { ...dave, amount: 40, refunded_amount: 10, handed_over_at: '2026-10-06T12:00:00Z' })] });
    expect((await loadBooksSummary(db.client, { tenantId: T, period: OCT })).moneyIn).toBe(30);
  });

  it('a business with no team gets exactly the old numbers', async () => {
    const db = fakeDb({ payments: [pay('a'), pay('b', { amount: 5.5, method: 'card' }), pay('c', { amount: 10, received_at: '2026-09-15T09:00:00Z' })] });
    const s = await loadBooksSummary(db.client, { tenantId: T, period: OCT });
    expect(s.moneyIn).toBe(25.5);
    expect(s.paymentsCount).toBe(2);
  });
});

describe('readMoneyInPayments', () => {
  it('returns each payment with the instant the books date it, oldest first', async () => {
    const rows = await readMoneyInPayments(mixed().client, { tenantId: T, columns: 'id, amount' });
    expect(rows.map((r) => [r.id, r.book_at])).toEqual([
      ['owner-cash', '2026-10-03T09:00:00Z'],
      ['card', '2026-10-04T09:00:00Z'],
      ['dave-handed', '2026-10-05T12:00:00Z'],
    ]);
  });

  it('applies extra filters from the caller', async () => {
    const rows = await readMoneyInPayments(mixed().client, {
      tenantId: T, columns: 'id, amount, method', refine: (q) => q.in('method', ['card']),
    });
    expect(rows.map((r) => r.id)).toEqual(['card']);
  });

  it('before the migration is pasted, every payment counts from when it was received', async () => {
    const db = mixed();
    const original = db.from.bind(db);
    const err = { code: '42703', message: 'column payments.collected_by_worker_id does not exist' };
    const failing = () => {
      const chain: Record<string, unknown> = {};
      for (const m of ['eq', 'is', 'or', 'not', 'gte', 'lt', 'gt', 'in', 'order']) chain[m] = () => chain;
      chain.range = () => Promise.resolve({ data: null, error: err });
      return chain;
    };
    db.from = ((table: string) => {
      const q = original(table) as unknown as { select: (cols: string, opts?: unknown) => unknown };
      const select = q.select.bind(q);
      // Any query that asks for the held-cash columns is refused, as the real database would before the paste.
      q.select = (cols: string, opts?: unknown) => (/collected_by|handed_over/.test(cols) ? failing() : select(cols, opts));
      return q;
    }) as never;
    const rows = await readMoneyInPayments(db.client, { tenantId: T, columns: 'id, amount' });
    expect(rows.map((r) => r.id).sort()).toEqual(['card', 'dave-handed', 'dave-held', 'owner-cash']);
    expect(rows.every((r) => r.book_at === r.received_at)).toBe(true);
  });

  it('throws the caller’s message on any other read error, never returning part of the numbers', async () => {
    const db = mixed();
    db.from = (() => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'is', 'or', 'not', 'gte', 'lt', 'gt', 'in', 'order']) chain[m] = () => chain;
      chain.range = () => Promise.resolve({ data: null, error: { message: 'boom' } });
      return chain;
    }) as never;
    await expect(readMoneyInPayments(db.client, { tenantId: T, columns: 'id', errorMessage: 'Could not load the books' })).rejects.toThrow('Could not load the books');
  });

  it('recognises the missing-column errors', () => {
    expect(isMissingHeldColumn({ code: '42703', message: 'x' })).toBe(true);
    expect(isMissingHeldColumn({ message: 'column payments.handed_over_at does not exist' })).toBe(true);
    expect(isMissingHeldColumn({ message: 'boom' })).toBe(false);
    expect(isMissingHeldColumn(null)).toBe(false);
  });
});

describe('cash taken today and cash with the team', () => {
  it('"cash taken" is what the owner has: owner cash that day plus team cash handed over that day', async () => {
    const db = mixed();
    expect(await getCashTakenOn(db.client, T, '2026-10-03')).toEqual({ cash: 20, cheque: 0 }); // Dave’s £30 was taken the 3rd but handed over the 5th
    expect(await getCashTakenOn(db.client, T, '2026-10-05')).toEqual({ cash: 30, cheque: 0 });
    expect(await getCashTakenOn(db.client, T, '2026-10-04')).toEqual({ cash: 0, cheque: 0 }); // the card payment is not cash
  });

  it('sums only what the team is holding right now', async () => {
    expect(await sumHeldCash(mixed().client, T)).toBe(50);
    expect(await sumHeldCash(fakeDb({ payments: [pay('a')] }).client, T)).toBe(0);
  });
});
