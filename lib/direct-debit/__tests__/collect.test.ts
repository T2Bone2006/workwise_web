import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const state = { value: 'on' as string };
const unlockable = { value: true };
const post = vi.fn();
const get = vi.fn();
const markDisconnected = vi.fn(async () => {});
const otherApp = vi.fn(async () => ({ count: 0, detail: '' }) as { count: number; detail: string } | { error: string });

vi.mock('@/lib/direct-debit/state', () => ({ getDirectDebitState: async () => state.value }));
vi.mock('@/lib/gocardless/connection', () => ({
  clientForTenant: async () =>
    unlockable.value ? { client: { post, get }, connection: { organisation_id: 'OR1', status: 'connected' } } : null,
  markDisconnected: (...a: unknown[]) => markDisconnected(...(a as [])),
}));
vi.mock('@/lib/direct-debit/existing', () => ({
  otherAppCollections: (...a: unknown[]) => otherApp(...(a as [])),
}));

import { GoCardlessError } from '@/lib/gocardless/client';
import {
  amountToCollect,
  collectForCustomer,
  loadCollectionNumbers,
  resumeCollection,
} from '@/lib/direct-debit/collect';

const TENANT = '11111111-1111-1111-1111-111111111111';
const CUSTOMER = '33333333-3333-3333-3333-333333333333';
const NOW = new Date('2026-10-01T17:00:00.000Z');

type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;
let db: Db;
let nextId = 1;

function fakeAdmin(): SupabaseClient {
  const from = (table: string) => {
    db[table] ??= [];
    const rows = db[table];
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: Row = {};
    const filters: ((r: Row) => boolean)[] = [];
    const run = (single: boolean) => {
      if (op === 'insert') {
        if (
          table === 'direct_debit_collections' &&
          payload.status === 'creating' &&
          rows.some((r) => r.customer_id === payload.customer_id && r.status === 'creating')
        ) {
          return { data: null, error: { code: '23505' } };
        }
        const row: Row = { id: `col-${nextId++}`, created_at: NOW.toISOString(), resolution: null, ...payload };
        rows.push(row);
        return { data: row, error: null };
      }
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === 'update') {
        for (const r of hit) Object.assign(r, payload);
        return { data: hit, error: null };
      }
      if (op === 'delete') {
        for (const r of hit) rows.splice(rows.indexOf(r), 1);
        return { data: null, error: null };
      }
      return { data: single ? (hit[0] ?? null) : hit, error: null };
    };
    const builder = {
      select() {
        return builder;
      },
      insert(row: Row) {
        op = 'insert';
        payload = row;
        return builder;
      },
      update(row: Row) {
        op = 'update';
        payload = row;
        return builder;
      },
      delete() {
        op = 'delete';
        return builder;
      },
      eq(c: string, v: unknown) {
        filters.push((r) => r[c] === v);
        return builder;
      },
      neq(c: string, v: unknown) {
        filters.push((r) => r[c] != null && r[c] !== v);
        return builder;
      },
      in(c: string, v: unknown[]) {
        filters.push((r) => v.includes(r[c]));
        return builder;
      },
      gte(c: string, v: string) {
        filters.push((r) => String(r[c]) >= v);
        return builder;
      },
      maybeSingle: async () => run(true),
      single: async () => run(true),
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(run(false)).then(resolve, reject);
      },
    };
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

function owes(amount: number) {
  db.customer_balances = [{ tenant_id: TENANT, customer_id: CUSTOMER, owed_amount: amount }];
}

function collectionRow(over: Row): Row {
  return {
    id: `col-${nextId++}`,
    tenant_id: TENANT,
    customer_id: CUSTOMER,
    direct_debit_id: 'dd-1',
    status: 'processing',
    resolution: null,
    created_at: '2026-09-25T17:00:00.000Z',
    ...over,
  };
}

function gcAccepts() {
  post.mockImplementation(async (_path: string, body: { payments: { amount: number } }) => ({
    payments: { id: `PM${nextId++}`, status: 'pending_submission', charge_date: '2026-10-06', amount: body.payments.amount },
  }));
}

const collect = (over: Partial<Parameters<typeof collectForCustomer>[1]> = {}) =>
  collectForCustomer(fakeAdmin(), { tenantId: TENANT, customerId: CUSTOMER, createdBy: 'cron', now: NOW, ...over });

beforeEach(() => {
  db = {
    tenants: [{ id: TENANT, name: 'Sparkle Windows' }],
    customer_balances: [],
    customer_direct_debits: [
      {
        id: 'dd-1',
        tenant_id: TENANT,
        customer_id: CUSTOMER,
        status: 'active',
        source: 'workwise',
        gocardless_mandate_id: 'MD1',
      },
    ],
    direct_debit_collections: [],
    gocardless_pay_requests: [],
    payments: [],
  };
  state.value = 'on';
  unlockable.value = true;
  post.mockReset();
  get.mockReset();
  markDisconnected.mockClear();
  otherApp.mockReset();
  otherApp.mockResolvedValue({ count: 0, detail: '' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('amountToCollect', () => {
  it('subtracts in pence, never negative', () => {
    expect(amountToCollect({ owed: 45, collecting: 15, heldFailed: 0, payingByBank: 0 })).toBe(30);
    expect(amountToCollect({ owed: 0.3, collecting: 0.1, heldFailed: 0.1, payingByBank: 0 })).toBe(0.1);
    expect(amountToCollect({ owed: 10, collecting: 15, heldFailed: 0, payingByBank: 0 })).toBe(0);
    expect(amountToCollect({ owed: 30, collecting: 0, heldFailed: 0, payingByBank: 0, left: 15 })).toBe(15);
  });
});

describe('collectForCustomer', () => {
  it('1. owed £15, nothing collecting → one £15 collection, body and key exactly as T25', async () => {
    owes(15);
    gcAccepts();
    const out = await collect();
    expect(out).toMatchObject({ kind: 'created', amount: 15 });
    const collectionId = (out as { collectionId: string }).collectionId;

    expect(post).toHaveBeenCalledTimes(1);
    const [path, body, opts] = post.mock.calls[0];
    expect(path).toBe('/payments');
    expect(opts).toEqual({ idempotencyKey: `ddc_${collectionId}` });
    expect(body).toEqual({
      payments: {
        amount: 1500,
        currency: 'GBP',
        description: 'Sparkle Windows',
        retry_if_possible: false,
        metadata: {
          workwise_tenant_id: TENANT,
          workwise_customer_id: CUSTOMER,
          workwise_collection_id: collectionId,
        },
        links: { mandate: 'MD1' },
      },
    });
    for (const banned of ['charge_date', 'reference', 'app_fee']) {
      expect(body.payments).not.toHaveProperty(banned);
    }

    expect(db.direct_debit_collections).toEqual([
      expect.objectContaining({
        id: collectionId,
        amount: 15,
        status: 'processing',
        created_by: 'cron',
        gocardless_status: 'pending_submission',
        charge_date: '2026-10-06',
        submitted_at: NOW.toISOString(),
      }),
    ]);
    // No payment is recorded here (step 11 does, on confirmed).
    expect(db.payments).toHaveLength(0);
  });

  it('2. paid cash the same day → owed £0 → nothing collected', async () => {
    owes(0);
    expect(await collect()).toEqual({ kind: 'skipped', reason: 'nothing_to_collect' });
    expect(post).not.toHaveBeenCalled();
    expect(db.direct_debit_collections).toHaveLength(0);
  });

  it('3. owed £45 with £15 processing → collects £30', async () => {
    owes(45);
    db.direct_debit_collections.push(collectionRow({ amount: 15, status: 'processing' }));
    gcAccepts();
    expect(await collect()).toMatchObject({ kind: 'created', amount: 30 });
  });

  it('4. an unresolved £15 failure is held back', async () => {
    owes(30);
    db.direct_debit_collections.push(collectionRow({ amount: 15, status: 'failed', resolution: null }));
    gcAccepts();
    expect(await collect()).toMatchObject({ kind: 'created', amount: 15 });
  });

  it('4b. paid by bank a minute ago (fulfilled, not confirmed) → nothing collected', async () => {
    owes(15);
    db.gocardless_pay_requests.push({ tenant_id: TENANT, customer_id: CUSTOMER, status: 'fulfilled', amount: 15 });
    expect(await collect()).toEqual({ kind: 'skipped', reason: 'nothing_to_collect' });
  });

  it('Leave it: a left failure is never collected by Direct Debit again, until they pay another way', async () => {
    owes(30);
    db.direct_debit_collections.push(
      collectionRow({ amount: 15, status: 'failed', resolution: 'left', created_at: '2026-09-25T17:00:00.000Z' }),
    );
    gcAccepts();
    expect(await collect()).toMatchObject({ kind: 'created', amount: 15 });

    // A later Direct Debit doesn't release it; a card payment after the failure does.
    db.direct_debit_collections = db.direct_debit_collections.filter((r) => r.status === 'failed');
    db.payments.push(
      { tenant_id: TENANT, customer_id: CUSTOMER, status: 'active', method: 'direct_debit', amount: 15, refunded_amount: 0, received_at: '2026-09-28T09:00:00Z' },
      { tenant_id: TENANT, customer_id: CUSTOMER, status: 'active', method: 'card', amount: 10, refunded_amount: 0, received_at: '2026-09-29T09:00:00Z' },
      { tenant_id: TENANT, customer_id: CUSTOMER, status: 'active', method: 'cash', amount: 50, refunded_amount: 0, received_at: '2026-09-20T09:00:00Z' },
    );
    const numbers = await loadCollectionNumbers(fakeAdmin(), TENANT, CUSTOMER);
    expect(numbers).toMatchObject({ owed: 30, heldFailed: 0, left: 5 });
  });

  it('5. two calls at once → one created, the other busy', async () => {
    owes(15);
    gcAccepts();
    const [a, b] = await Promise.all([collect(), collect()]);
    expect([a.kind, b.kind].sort()).toEqual(['created', 'skipped']);
    expect([a, b]).toContainEqual({ kind: 'skipped', reason: 'busy' });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('6. GoCardless down → row stays creating; the resume re-sends with the same key and a 409 recovers it', async () => {
    owes(15);
    post.mockRejectedValueOnce(new GoCardlessError({ message: 'Could not reach GoCardless', status: 0 }));
    const out = await collect();
    expect(out).toMatchObject({ kind: 'error' });
    const collectionId = (out as { collectionId: string }).collectionId;
    expect(db.direct_debit_collections[0]).toMatchObject({ id: collectionId, status: 'creating' });

    // The first call did get through: GoCardless answers 409 with that payment.
    post.mockRejectedValueOnce(
      new GoCardlessError({
        message: 'A resource has already been created with this idempotency key',
        status: 409,
        type: 'invalid_state',
        reasons: ['idempotent_creation_conflict'],
        conflictingResourceId: 'PM_FIRST',
      }),
    );
    get.mockResolvedValueOnce({ payments: { id: 'PM_FIRST', status: 'submitted', charge_date: '2026-10-06' } });
    const resumed = await resumeCollection(fakeAdmin(), collectionId, new Date(NOW.getTime() + 14 * 3600_000));
    expect(resumed).toEqual({ kind: 'created', collectionId, amount: 15 });
    expect(post.mock.calls[1][2]).toEqual({ idempotencyKey: `ddc_${collectionId}` });
    expect(post.mock.calls[1][1]).toEqual(post.mock.calls[0][1]);
    expect(get).toHaveBeenCalledWith('/payments/PM_FIRST');
    expect(db.direct_debit_collections[0]).toMatchObject({ status: 'processing', gocardless_payment_id: 'PM_FIRST' });
  });

  it('a 5xx or 429 also leaves the row creating', async () => {
    owes(15);
    post.mockRejectedValueOnce(new GoCardlessError({ message: 'Internal error', status: 500 }));
    expect((await collect()).kind).toBe('error');
    expect(db.direct_debit_collections[0].status).toBe('creating');
  });

  it('7. owed £1,250 → too_large, nothing created', async () => {
    owes(1250);
    expect(await collect()).toEqual({ kind: 'too_large', amount: 1250 });
    expect(db.direct_debit_collections).toHaveLength(0);
    expect(post).not.toHaveBeenCalled();
  });

  it('8. an imported Direct Debit where the old app has a payment waiting → other_app, nothing created', async () => {
    owes(15);
    db.customer_direct_debits[0].source = 'imported';
    otherApp.mockResolvedValueOnce({ count: 1, detail: '1 collection waiting' });
    expect(await collect()).toEqual({ kind: 'other_app', detail: '1 collection waiting' });
    expect(otherApp).toHaveBeenCalledWith(expect.anything(), { tenantId: TENANT, mandateId: 'MD1' });
    expect(db.direct_debit_collections).toHaveLength(0);
  });

  it('old-app check fails → no collection (fail safe)', async () => {
    owes(15);
    db.customer_direct_debits[0].source = 'imported';
    otherApp.mockResolvedValueOnce({ error: "Couldn't reach GoCardless — try again." });
    expect(await collect()).toEqual({
      kind: 'error',
      collectionId: null,
      message: "Couldn't reach GoCardless — try again.",
    });
    expect(post).not.toHaveBeenCalled();
    expect(db.direct_debit_collections).toHaveLength(0);
  });

  it('the old-app check is only for imported Direct Debits', async () => {
    owes(15);
    gcAccepts();
    await collect();
    expect(otherApp).not.toHaveBeenCalled();
  });

  it('9. business not on → not_available for everyone', async () => {
    owes(15);
    state.value = 'needs_details';
    expect(await collect()).toEqual({ kind: 'skipped', reason: 'not_available' });
    state.value = 'on';
    unlockable.value = false;
    expect(await collect()).toEqual({ kind: 'skipped', reason: 'not_available' });
    expect(post).not.toHaveBeenCalled();
  });

  it('no live Direct Debit → no_direct_debit', async () => {
    owes(15);
    db.customer_direct_debits[0].status = 'cancelled';
    expect(await collect()).toEqual({ kind: 'skipped', reason: 'no_direct_debit' });
  });

  it('validation_failed → error row, the Direct Debit untouched', async () => {
    owes(15);
    post.mockRejectedValueOnce(
      new GoCardlessError({ message: 'Validation failed', status: 422, type: 'validation_failed', reasons: ['greater_than'] }),
    );
    expect(await collect()).toMatchObject({ kind: 'error', message: 'Validation failed' });
    expect(db.direct_debit_collections[0]).toMatchObject({
      status: 'error',
      failure_code: 'greater_than',
      failure_message: 'Validation failed',
    });
    expect(db.customer_direct_debits[0].status).toBe('active');
  });

  it('mandate_is_inactive → error row and the Direct Debit becomes inactive', async () => {
    owes(15);
    post.mockRejectedValueOnce(
      new GoCardlessError({ message: 'Mandate is inactive', status: 422, type: 'invalid_state', reasons: ['mandate_is_inactive'] }),
    );
    await collect();
    expect(db.direct_debit_collections[0].status).toBe('error');
    expect(db.customer_direct_debits[0]).toMatchObject({
      status: 'inactive',
      inactive_reason: 'GoCardless says this Direct Debit is no longer active',
    });
  });

  it('a revoked token disconnects and errors the row', async () => {
    owes(15);
    post.mockRejectedValueOnce(
      new GoCardlessError({ message: 'Access token revoked', status: 401, type: 'invalid_api_usage', reasons: ['access_token_revoked'] }),
    );
    await collect();
    expect(markDisconnected).toHaveBeenCalledWith(expect.anything(), TENANT, 'GoCardless access was removed');
    expect(db.direct_debit_collections[0].status).toBe('error');
  });

  it('Collect again: a trader amount, capped by what is owed now minus collecting', async () => {
    owes(20);
    db.direct_debit_collections.push(
      collectionRow({ amount: 15, status: 'failed', resolution: 'collect_again' }),
      collectionRow({ amount: 10, status: 'processing' }),
    );
    gcAccepts();
    expect(await collect({ createdBy: 'trader', userId: 'user-1', amount: 15 })).toMatchObject({
      kind: 'created',
      amount: 10,
    });
    expect(db.direct_debit_collections.find((r) => r.status === 'processing' && r.created_by === 'trader')).toMatchObject({
      created_by_user_id: 'user-1',
    });
  });

  it('re-check after claiming: money that arrived meanwhile shrinks or cancels the claim', async () => {
    owes(15);
    // Another collection finishes the moment this one is claimed.
    const admin = fakeAdmin();
    const realFrom = (admin as unknown as { from: (t: string) => unknown }).from;
    let claimed = false;
    const racing = {
      from(table: string) {
        if (table === 'customer_balances' && claimed) owes(0);
        const b = realFrom(table) as Record<string, (...a: unknown[]) => unknown>;
        if (table === 'direct_debit_collections') {
          const insert = b.insert.bind(b);
          b.insert = (row: unknown) => {
            claimed = true;
            return insert(row);
          };
        }
        return b;
      },
    } as unknown as SupabaseClient;
    const out = await collectForCustomer(racing, { tenantId: TENANT, customerId: CUSTOMER, createdBy: 'cron', now: NOW });
    expect(out).toEqual({ kind: 'skipped', reason: 'nothing_to_collect' });
    expect(db.direct_debit_collections).toHaveLength(0);
    expect(post).not.toHaveBeenCalled();
  });
});

describe('resumeCollection', () => {
  it('older than 24 hours → error, never sent', async () => {
    db.direct_debit_collections.push(
      collectionRow({ id: 'col-old', amount: 15, status: 'creating', created_at: '2026-09-29T17:00:00.000Z' }),
    );
    expect(await resumeCollection(fakeAdmin(), 'col-old', NOW)).toEqual({
      kind: 'error',
      collectionId: 'col-old',
      message: 'Never reached GoCardless',
    });
    expect(db.direct_debit_collections[0]).toMatchObject({ status: 'error', failure_message: 'Never reached GoCardless' });
    expect(post).not.toHaveBeenCalled();
  });

  it('a row that already moved on is left alone', async () => {
    db.direct_debit_collections.push(collectionRow({ id: 'col-done', amount: 15, status: 'processing' }));
    expect((await resumeCollection(fakeAdmin(), 'col-done', NOW)).kind).toBe('skipped');
    expect(post).not.toHaveBeenCalled();
  });
});
