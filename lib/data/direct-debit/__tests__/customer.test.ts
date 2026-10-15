import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/direct-debit/after-collection', () => ({
  failureReasonText: (code: string | null) => (code === 'insufficient_funds' ? 'not enough money in their account' : "their bank didn't pay it"),
}));

import { getCustomerDirectDebit, getDirectDebitSummaries } from '@/lib/data/direct-debit/customer';
import { getExistingDirectDebits } from '@/lib/data/direct-debit/existing';

const T = 'tenant-1';
const C = 'cust-1';
const NOW = new Date('2026-10-02T12:00:00.000Z');

type Row = Record<string, unknown>;
let db: Record<string, Row[]>;
let failTable: string | null = null;

function fakeAdmin(): SupabaseClient {
  const from = (table: string) => {
    db[table] ??= [];
    const filters: ((r: Row) => boolean)[] = [];
    const run = (single: boolean) => {
      if (table === failTable) return { data: null, error: { code: 'XX000' } };
      const hit = db[table].filter((r) => filters.every((f) => f(r)));
      return { data: single ? (hit[0] ?? null) : hit, error: null };
    };
    const b = {
      select: () => b,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), b),
      maybeSingle: async () => run(true),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run(false)).then(res, rej),
    };
    return b;
  };
  return { from } as unknown as SupabaseClient;
}

const dd = (over: Row = {}): Row => ({
  tenant_id: T,
  customer_id: C,
  status: 'active',
  bank_name: 'Monzo',
  account_number_ending: '34',
  source: 'workwise',
  activated_at: '2026-09-20T09:00:00.000Z',
  cancelled_by: null,
  inactive_reason: null,
  created_at: '2026-09-15T09:00:00.000Z',
  ...over,
});
const col = (over: Row = {}): Row => ({
  tenant_id: T,
  customer_id: C,
  id: `col-${Math.random()}`,
  amount: 15,
  status: 'succeeded',
  resolution: null,
  charge_date: null,
  failure_code: null,
  submitted_at: null,
  finished_at: null,
  created_at: '2026-09-25T09:00:00.000Z',
  ...over,
});

beforeEach(() => {
  db = { customer_direct_debits: [], direct_debit_collections: [], gocardless_mandate_links: [], gocardless_connections: [], customers: [] };
  failTable = null;
});

describe('getCustomerDirectDebit', () => {
  it('a customer who never started: not_set_up, zeros, empty lists', async () => {
    const out = await getCustomerDirectDebit(fakeAdmin(), T, C, NOW);
    expect(out).toEqual({
      status: 'not_set_up',
      bankEnding: null,
      bankName: null,
      source: null,
      activeSince: null,
      cancelledBy: null,
      inactiveReason: null,
      collecting: { amount: 0, expectedOn: null, count: 0 },
      failed: [],
      recent: [],
    });
  });

  it.each(['pending', 'active', 'inactive', 'cancelled'])('shows a %s Direct Debit with its bank', async (status) => {
    db.customer_direct_debits = [dd({ status, cancelled_by: status === 'cancelled' ? 'bank' : null, inactive_reason: status === 'inactive' ? 'Their bank didn\'t accept it' : null })];
    const out = await getCustomerDirectDebit(fakeAdmin(), T, C, NOW);
    expect(out.status).toBe(status);
    expect(out).toMatchObject({ bankEnding: '34', bankName: 'Monzo', source: 'workwise', activeSince: '2026-09-20T09:00:00.000Z' });
    if (status === 'cancelled') expect(out.cancelledBy).toBe('bank');
    if (status === 'inactive') expect(out.inactiveReason).toBe("Their bank didn't accept it");
  });

  it('a set-up page opened today is setting_up; one older than a day is not_set_up', async () => {
    db.customer_direct_debits = [dd({ status: 'setting_up', created_at: '2026-10-02T08:00:00.000Z', account_number_ending: null, bank_name: null })];
    expect((await getCustomerDirectDebit(fakeAdmin(), T, C, NOW)).status).toBe('setting_up');
    db.customer_direct_debits = [dd({ status: 'setting_up', created_at: '2026-10-01T08:00:00.000Z' })];
    const stale = await getCustomerDirectDebit(fakeAdmin(), T, C, NOW);
    expect(stale.status).toBe('not_set_up');
    expect(stale.bankEnding).toBeNull();
  });

  it('a live Direct Debit wins over a newer abandoned one; otherwise the newest row', async () => {
    db.customer_direct_debits = [
      dd({ status: 'active', created_at: '2026-09-01T00:00:00.000Z' }),
      dd({ status: 'setting_up', created_at: '2026-10-02T09:00:00.000Z' }),
    ];
    expect((await getCustomerDirectDebit(fakeAdmin(), T, C, NOW)).status).toBe('active');
    db.customer_direct_debits = [
      dd({ status: 'cancelled', created_at: '2026-09-01T00:00:00.000Z' }),
      dd({ status: 'inactive', created_at: '2026-09-10T00:00:00.000Z' }),
    ];
    expect((await getCustomerDirectDebit(fakeAdmin(), T, C, NOW)).status).toBe('inactive');
  });

  it('collecting sums creating + processing and takes the earliest charge date', async () => {
    db.direct_debit_collections = [
      col({ status: 'creating', amount: 5.1 }),
      col({ status: 'processing', amount: 10.2, charge_date: '2026-10-08' }),
      col({ status: 'processing', amount: 1, charge_date: '2026-10-06' }),
      col({ status: 'succeeded', amount: 99, charge_date: '2026-10-01' }),
    ];
    const out = await getCustomerDirectDebit(fakeAdmin(), T, C, NOW);
    expect(out.collecting).toEqual({ amount: 16.3, expectedOn: '2026-10-06', count: 3 });
  });

  it('failed lists only unresolved ones, newest first, with a plain reason', async () => {
    db.direct_debit_collections = [
      col({ id: 'old', status: 'failed', failure_code: 'insufficient_funds', finished_at: '2026-09-26T10:00:00.000Z', created_at: '2026-09-25T09:00:00.000Z' }),
      col({ id: 'new', status: 'failed', failure_code: null, finished_at: '2026-09-30T10:00:00.000Z', created_at: '2026-09-29T09:00:00.000Z' }),
      col({ id: 'sorted', status: 'failed', resolution: 'left', finished_at: '2026-09-27T10:00:00.000Z' }),
    ];
    const out = await getCustomerDirectDebit(fakeAdmin(), T, C, NOW);
    expect(out.failed).toEqual([
      { collectionId: 'new', amount: 15, failedOn: '2026-09-30', reason: "their bank didn't pay it" },
      { collectionId: 'old', amount: 15, failedOn: '2026-09-26', reason: 'not enough money in their account' },
    ]);
  });

  it('recent is the last 10, creating shown as processing', async () => {
    db.direct_debit_collections = Array.from({ length: 12 }, (_, i) =>
      col({ id: `c${i}`, created_at: `2026-09-${String(10 + i).padStart(2, '0')}T09:00:00.000Z`, status: i === 11 ? 'creating' : 'succeeded' }),
    );
    const out = await getCustomerDirectDebit(fakeAdmin(), T, C, NOW);
    expect(out.recent).toHaveLength(10);
    expect(out.recent[0]).toMatchObject({ collectionId: 'c11', status: 'processing' });
    expect(out.recent[9].collectionId).toBe('c2');
  });

  it("only this business's rows, and a read error gives the empty picture", async () => {
    db.customer_direct_debits = [dd({ tenant_id: 'other' })];
    expect((await getCustomerDirectDebit(fakeAdmin(), T, C, NOW)).status).toBe('not_set_up');
    db.customer_direct_debits = [dd()];
    failTable = 'direct_debit_collections';
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await getCustomerDirectDebit(fakeAdmin(), T, C, NOW)).status).toBe('not_set_up');
    spy.mockRestore();
  });
});

describe('getDirectDebitSummaries', () => {
  it('per customer: collecting, has a Direct Debit, failed waiting', async () => {
    db.customer_direct_debits = [dd({ customer_id: 'a' }), dd({ customer_id: 'b', status: 'pending' })];
    db.direct_debit_collections = [
      col({ customer_id: 'a', status: 'processing', amount: 15 }),
      col({ customer_id: 'a', status: 'creating', amount: 5 }),
      col({ customer_id: 'b', status: 'failed' }),
      col({ customer_id: 'b', status: 'failed', resolution: 'left' }),
      col({ customer_id: 'c', status: 'failed' }),
    ];
    const map = await getDirectDebitSummaries(fakeAdmin(), T);
    expect(map.get('a')).toEqual({ collecting: 20, hasDirectDebit: true, failedCount: 0 });
    expect(map.get('b')).toEqual({ collecting: 0, hasDirectDebit: true, failedCount: 1 });
    expect(map.get('c')).toEqual({ collecting: 0, hasDirectDebit: false, failedCount: 1 });
    expect(map.get('nobody')).toBeUndefined();
  });

  it('a read error gives an empty map', async () => {
    failTable = 'customer_direct_debits';
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await getDirectDebitSummaries(fakeAdmin(), T)).size).toBe(0);
    spy.mockRestore();
  });
});

describe('getExistingDirectDebits', () => {
  const link = (over: Row = {}): Row => ({
    id: `l-${Math.random()}`,
    tenant_id: T,
    mandate_status: 'active',
    decision: 'pending',
    match_kind: 'none',
    payer_name: 'Zed',
    other_collections: 0,
    suggested_customer_id: null,
    linked_customer_id: null,
    direct_debit_id: null,
    ...over,
  });

  it('groups by decision; only linkable mandate statuses are offered; best matches first', async () => {
    db.gocardless_connections = [{ tenant_id: T, mandates_checked_at: '2026-10-02T07:00:00.000Z' }];
    db.customers = [
      { id: 'c1', tenant_id: T, name: 'Jane Wright' },
      { id: 'c2', tenant_id: T, name: 'Bob Hill' },
    ];
    db.gocardless_mandate_links = [
      link({ id: 'none', payer_name: 'Amy' }),
      link({ id: 'email', match_kind: 'email', payer_name: 'Zoe', suggested_customer_id: 'c1', payer_email: 'j@x.com' }),
      link({ id: 'prob', match_kind: 'name_postcode', payer_name: 'Ann', suggested_customer_id: 'c2' }),
      link({ id: 'cancelled', mandate_status: 'cancelled' }),
      link({ id: 'linked', decision: 'linked', linked_customer_id: 'c1', direct_debit_id: 'dd-1' }),
      link({ id: 'ignored', decision: 'ignored' }),
    ];
    const out = await getExistingDirectDebits(fakeAdmin(), T);
    expect(out.checkedAt).toBe('2026-10-02T07:00:00.000Z');
    expect(out.toLink.map((x) => x.linkId)).toEqual(['email', 'prob', 'none']);
    expect(out.toLink[0]).toMatchObject({ suggested: { customerId: 'c1', name: 'Jane Wright' }, payerEmail: 'j@x.com' });
    expect(out.linked.map((x) => x.linkId)).toEqual(['linked']);
    expect(out.linked[0].linked).toEqual({ customerId: 'c1', name: 'Jane Wright' });
    expect(out.ignored.map((x) => x.linkId)).toEqual(['ignored']);
  });

  it('tells a system link (same email) from one a person made', async () => {
    db.gocardless_mandate_links = [
      link({ id: 'auto', decision: 'linked', direct_debit_id: 'dd-1', decided_by_user_id: null }),
      link({ id: 'by-hand', decision: 'linked', direct_debit_id: 'dd-2', decided_by_user_id: 'user-1' }),
    ];
    const out = await getExistingDirectDebits(fakeAdmin(), T);
    const by = Object.fromEntries(out.linked.map((x) => [x.linkId, x.linkedAutomatically]));
    expect(by).toEqual({ auto: true, 'by-hand': false });
  });

  it('a linked Direct Debit can be undone only until it has a collection; ignored can always be undone', async () => {
    db.gocardless_mandate_links = [
      link({ id: 'fresh', decision: 'linked', direct_debit_id: 'dd-1' }),
      link({ id: 'used', decision: 'linked', direct_debit_id: 'dd-2' }),
      link({ id: 'ign', decision: 'ignored' }),
    ];
    db.direct_debit_collections = [col({ direct_debit_id: 'dd-2' })];
    const out = await getExistingDirectDebits(fakeAdmin(), T);
    const by = Object.fromEntries([...out.linked, ...out.ignored].map((x) => [x.linkId, x.canUnlink]));
    expect(by).toEqual({ fresh: true, used: false, ign: true });
  });

  it("can't tell whether collections exist → no Undo; a link read error gives empty lists", async () => {
    db.gocardless_mandate_links = [link({ id: 'l', decision: 'linked', direct_debit_id: 'dd-1' })];
    failTable = 'direct_debit_collections';
    expect((await getExistingDirectDebits(fakeAdmin(), T)).linked[0].canUnlink).toBe(false);
    failTable = 'gocardless_mandate_links';
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await getExistingDirectDebits(fakeAdmin(), T)).toEqual({ checkedAt: null, toLink: [], linked: [], ignored: [] });
    spy.mockRestore();
  });
});
