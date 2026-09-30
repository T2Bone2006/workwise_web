import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const TENANT = '11111111-1111-1111-1111-111111111111';
const CUSTOMER = '33333333-3333-3333-3333-333333333333';
const COLLECTION = '44444444-4444-4444-4444-444444444444';
const NOW = new Date('2026-10-01T10:00:00.000Z');

const gc: Record<string, unknown> = {};
const get = vi.fn(async (path: string) => {
  if (!(path in gc)) throw new Error(`unexpected GET ${path}`);
  return gc[path];
});
const action = vi.fn(async () => ({}));
const pushes: { kind: string; title: string; body: string; data: unknown }[] = [];
const connection = {
  value: { status: 'connected', verification_status: 'successful' } as Record<string, unknown> | null,
};
const markDisconnected = vi.fn(async () => {});
/** clientForTenant succeeds unless a test says otherwise; connectionStatus is what the database says. */
const unlockable = { value: true };
const storedStatus = { value: 'connected' as string | null | Error };
const refreshVerification = vi.fn();

vi.mock('@/lib/gocardless/connection', () => ({
  clientForTenant: async () =>
    unlockable.value
      ? { client: { get, action }, connection: { organisation_id: 'OR1', status: 'connected' } }
      : null,
  connectionStatus: async () => {
    if (storedStatus.value instanceof Error) throw storedStatus.value;
    return storedStatus.value;
  },
  getConnection: async () => connection.value,
  markDisconnected: (...a: unknown[]) => markDisconnected(...(a as [])),
  refreshVerification: (...a: unknown[]) => refreshVerification(...a),
}));
const afterCollectionFailed = vi.fn(async () => {});
vi.mock('@/lib/direct-debit/after-collection', () => ({
  afterCollectionFailed: (...a: unknown[]) => afterCollectionFailed(...(a as [])),
}));
vi.mock('@/lib/push/owner-push', () => ({
  sendOrHoldOwnerPush: async (_a: unknown, _t: string, p: { kind: string; title: string; body: string; data: unknown }) => {
    pushes.push(p);
    return 'sent';
  },
}));

import { GoCardlessError } from '@/lib/gocardless/client';
import {
  processGoCardlessEvents,
  refreshCollection,
  storeGoCardlessEvents,
  type GcEvent,
} from '@/lib/direct-debit/webhook';

type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;
let db: Db;
let nextId = 1;
const failInsert = { payments: null as null | { code: string } };

function valueAt(row: Row, column: string): unknown {
  const parts = column.split(/->>|->/);
  let cur: unknown = row;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Row)[part];
  }
  return cur;
}

function fakeAdmin(): SupabaseClient {
  const from = (table: string) => {
    db[table] ??= [];
    const rows = db[table];
    let op: 'select' | 'insert' | 'update' | 'upsert' = 'select';
    let payload: Row | Row[] = {};
    let upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
    const filters: ((r: Row) => boolean)[] = [];
    let max = Infinity;
    const run = (single: boolean, mustExist: boolean) => {
      if (op === 'insert') {
        if (table === 'payments' && failInsert.payments) return { data: null, error: failInsert.payments };
        const row: Row = { id: `id-${nextId++}`, ...(payload as Row) };
        const unique = table === 'payments' ? 'gocardless_payment_id' : null;
        if (unique && rows.some((r) => r[unique] === row[unique])) {
          return { data: null, error: { code: '23505' } };
        }
        rows.push(row);
        return { data: row, error: null };
      }
      if (op === 'upsert') {
        const key = upsertOpts.onConflict ?? 'id';
        for (const r of payload as Row[]) {
          if (!rows.some((x) => x[key] === r[key])) rows.push({ ...r });
        }
        return { data: null, error: null };
      }
      const hit = rows.filter((r) => filters.every((f) => f(r))).slice(0, max);
      if (op === 'update') {
        for (const r of hit) Object.assign(r, payload);
        return { data: hit, error: null };
      }
      if (single) {
        if (mustExist && hit.length !== 1) return { data: null, error: { code: 'PGRST116' } };
        return { data: hit[0] ?? null, error: null };
      }
      return { data: hit, error: null };
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
      upsert(list: Row[], opts: typeof upsertOpts) {
        op = 'upsert';
        payload = list;
        upsertOpts = opts;
        return builder;
      },
      eq(c: string, v: unknown) {
        filters.push((r) => valueAt(r, c) === v);
        return builder;
      },
      /** PostgREST `a.is.null,a.neq.x` — SQL semantics: neq never matches null. */
      or(expr: string) {
        const parts = expr.split(',').map((part) => {
          const [col, op, ...rest] = part.split('.');
          const val = rest.join('.');
          return (r: Row) => {
            const cur = valueAt(r, col);
            if (op === 'is' && val === 'null') return cur == null;
            if (op === 'eq') return cur != null && String(cur) === val;
            if (op === 'neq') return cur != null && String(cur) !== val;
            throw new Error(`fake or: ${part}`);
          };
        });
        filters.push((r) => parts.some((f) => f(r)));
        return builder;
      },
      neq(c: string, v: unknown) {
        filters.push((r) => valueAt(r, c) !== v);
        return builder;
      },
      in(c: string, v: unknown[]) {
        filters.push((r) => v.includes(valueAt(r, c)));
        return builder;
      },
      is(c: string, v: unknown) {
        filters.push((r) => (valueAt(r, c) ?? null) === v);
        return builder;
      },
      lte(c: string, v: string) {
        filters.push((r) => String(valueAt(r, c)) <= v);
        return builder;
      },
      gte(c: string, v: string) {
        filters.push((r) => String(valueAt(r, c)) >= v);
        return builder;
      },
      order() {
        return builder;
      },
      limit(n: number) {
        max = n;
        return builder;
      },
      maybeSingle: async () => run(true, false),
      single: async () => run(true, true),
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(run(false, false)).then(resolve, reject);
      },
    };
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

function ev(p: Partial<GcEvent> & Pick<GcEvent, 'resource_type' | 'action'>): GcEvent {
  return {
    id: `EV${nextId++}`,
    created_at: '2026-10-01T09:59:00.000Z',
    links: { organisation: 'OR1' },
    ...p,
  };
}

/** Stores and processes one event as the route does. */
async function run(admin: SupabaseClient, event: GcEvent) {
  const ids = await storeGoCardlessEvents(admin, [event]);
  return processGoCardlessEvents(admin, { ids, now: NOW });
}

const ddRow = (over: Row = {}): Row => ({
  id: 'dd-1',
  tenant_id: TENANT,
  customer_id: CUSTOMER,
  status: 'setting_up',
  source: 'workwise',
  gocardless_billing_request_id: 'BRQ1',
  gocardless_mandate_id: null,
  ...over,
});

beforeEach(() => {
  db = {
    gocardless_connections: [{ tenant_id: TENANT, organisation_id: 'OR1', status: 'connected' }],
    gocardless_events: [],
    customers: [{ id: CUSTOMER, tenant_id: TENANT, name: 'Jane Wright' }],
    customer_direct_debits: [],
    direct_debit_collections: [],
    payments: [],
    gocardless_pay_requests: [],
    gocardless_mandate_links: [],
  };
  for (const k of Object.keys(gc)) delete gc[k];
  get.mockClear();
  action.mockClear();
  markDisconnected.mockClear();
  refreshVerification.mockReset();
  pushes.length = 0;
  afterCollectionFailed.mockClear();
  failInsert.payments = null;
  connection.value = { status: 'connected', verification_status: 'successful' };
  unlockable.value = true;
  storedStatus.value = 'connected';
});

describe('storeGoCardlessEvents', () => {
  it('stores once, finds the tenant, and synthesises the disconnect id', async () => {
    const admin = fakeAdmin();
    const a = ev({ id: 'EVA', resource_type: 'mandates', action: 'active', links: { organisation: 'OR1', mandate: 'MD1' } });
    const gone = ev({ id: null, resource_type: 'organisations', action: 'disconnected', created_at: '2026-10-01T09:00:00.000Z' });
    const ids = await storeGoCardlessEvents(admin, [a, gone]);
    expect(ids).toEqual(['EVA', 'disconnect_OR1_2026-10-01T09:00:00.000Z']);
    expect(db.gocardless_events).toHaveLength(2);
    expect(db.gocardless_events[0].tenant_id).toBe(TENANT);
    expect(db.gocardless_events[0].resource_id).toBe('MD1');

    const again = await storeGoCardlessEvents(admin, [a]);
    expect(again).toEqual(['EVA']);
    expect(db.gocardless_events).toHaveLength(2);
  });

  it('keeps events for an unknown business with no tenant (they are ignored later)', async () => {
    const admin = fakeAdmin();
    const stranger = ev({ resource_type: 'mandates', action: 'active', links: { organisation: 'OR9', mandate: 'MD9' } });
    await storeGoCardlessEvents(admin, [stranger]);
    expect(db.gocardless_events[0].tenant_id).toBeNull();
    const out = await processGoCardlessEvents(admin, { ids: [stranger.id as string], now: NOW });
    expect(out).toEqual({ processed: 1, failed: 0 });
    expect(get).not.toHaveBeenCalled();
  });
});

describe('billing_requests', () => {
  function billingRequest(kind: string, mandateStatus = 'active') {
    gc['/billing_requests/BRQ1'] = {
      billing_requests: {
        id: 'BRQ1',
        metadata: { workwise_tenant_id: TENANT, workwise_customer_id: CUSTOMER, workwise_kind: kind },
        links: { customer: 'CU1', mandate_request_mandate: 'MD1' },
      },
    };
    gc['/mandates/MD1'] = {
      mandates: {
        id: 'MD1',
        status: mandateStatus,
        reference: 'WW-123',
        next_possible_charge_date: '2026-10-06',
        links: { customer_bank_account: 'BA1' },
      },
    };
    gc['/customer_bank_accounts/BA1'] = {
      customer_bank_accounts: { bank_name: 'Monzo', account_number_ending: '78' },
    };
  }
  const fulfilled = () =>
    ev({ resource_type: 'billing_requests', action: 'fulfilled', links: { organisation: 'OR1', billing_request: 'BRQ1' } });

  it('dd_setup with an active mandate → active, tells the trader, and replays cleanly', async () => {
    db.customer_direct_debits = [ddRow()];
    const admin = fakeAdmin();
    await run(admin, fulfilled());
    billingRequest('dd_setup');
    await run(admin, fulfilled());
    expect(db.customer_direct_debits[0]).toMatchObject({
      status: 'active',
      gocardless_mandate_id: 'MD1',
      gocardless_customer_id: 'CU1',
      bank_name: 'Monzo',
      account_number_ending: '78',
      mandate_reference: 'WW-123',
    });
    expect(pushes.map((p) => p.title)).toEqual(['Direct Debit ready']);
    await run(admin, fulfilled());
    expect(pushes).toHaveLength(1);
  });

  it('a submitted mandate → pending, no push; a failed one → inactive with the reason', async () => {
    db.customer_direct_debits = [ddRow()];
    billingRequest('dd_setup', 'submitted');
    await run(fakeAdmin(), fulfilled());
    expect(db.customer_direct_debits[0].status).toBe('pending');
    expect(pushes).toHaveLength(0);

    db.customer_direct_debits = [ddRow()];
    billingRequest('dd_setup', 'failed');
    await run(fakeAdmin(), fulfilled());
    expect(db.customer_direct_debits[0]).toMatchObject({
      status: 'inactive',
      inactive_reason: "Their bank didn't accept it",
    });
  });

  it('cancels and replaces another live Direct Debit for the same customer', async () => {
    db.customer_direct_debits = [
      ddRow(),
      ddRow({ id: 'dd-old', status: 'active', gocardless_billing_request_id: 'BRQ0', gocardless_mandate_id: 'MDOLD' }),
    ];
    billingRequest('dd_setup');
    await run(fakeAdmin(), fulfilled());
    expect(action).toHaveBeenCalledWith('/mandates/MDOLD/actions/cancel');
    expect(db.customer_direct_debits[1]).toMatchObject({ status: 'cancelled', cancelled_by: 'customer' });
    expect(db.customer_direct_debits[0].status).toBe('active');
  });

  it('a refused new set-up never cancels the customer\'s working Direct Debit', async () => {
    db.customer_direct_debits = [
      ddRow(),
      ddRow({ id: 'dd-old', status: 'active', gocardless_billing_request_id: 'BRQ0', gocardless_mandate_id: 'MDOLD' }),
    ];
    billingRequest('dd_setup', 'failed');
    await run(fakeAdmin(), fulfilled());
    expect(action).not.toHaveBeenCalled();
    expect(db.customer_direct_debits[1].status).toBe('active');
    expect(db.customer_direct_debits[0].status).toBe('inactive');
  });

  it('ignores another business, unknown kinds and other actions', async () => {
    db.customer_direct_debits = [ddRow()];
    billingRequest('something_else');
    await run(fakeAdmin(), fulfilled());
    expect(db.customer_direct_debits[0].status).toBe('setting_up');

    billingRequest('dd_setup');
    (gc['/billing_requests/BRQ1'] as { billing_requests: { metadata: Row } }).billing_requests.metadata.workwise_tenant_id = 'other';
    await run(fakeAdmin(), fulfilled());
    expect(db.customer_direct_debits[0].status).toBe('setting_up');

    billingRequest('dd_setup');
    await run(fakeAdmin(), ev({ resource_type: 'billing_requests', action: 'created', links: { organisation: 'OR1', billing_request: 'BRQ1' } }));
    expect(db.customer_direct_debits[0].status).toBe('setting_up');
  });

  it('routes pay_by_bank and pay_and_dd (pay_by_bank alone sets up no Direct Debit)', async () => {
    db.customer_direct_debits = [ddRow()];
    billingRequest('pay_by_bank');
    await run(fakeAdmin(), fulfilled());
    expect(db.customer_direct_debits[0].status).toBe('setting_up');

    billingRequest('pay_and_dd');
    await run(fakeAdmin(), fulfilled());
    expect(db.customer_direct_debits[0].status).toBe('active');
  });
});

describe('mandates', () => {
  const mandateEvent = (action: string, extra: Partial<GcEvent> = {}) =>
    ev({ resource_type: 'mandates', action, links: { organisation: 'OR1', mandate: 'MD1' }, ...extra });
  const mandate = (status: string) => {
    gc['/mandates/MD1'] = { mandates: { id: 'MD1', status, next_possible_charge_date: '2026-10-06', links: { customer_bank_account: 'BA1' } } };
    gc['/customer_bank_accounts/BA1'] = { customer_bank_accounts: { bank_name: 'Barclays', account_number_ending: '11' } };
  };
  const pending = (over: Row = {}) => ddRow({ status: 'pending', gocardless_mandate_id: 'MD1', ...over });

  it('active → activates a pending row once', async () => {
    db.customer_direct_debits = [pending()];
    mandate('active');
    const admin = fakeAdmin();
    await run(admin, mandateEvent('active'));
    await run(admin, mandateEvent('active'));
    expect(db.customer_direct_debits[0].status).toBe('active');
    expect(pushes).toHaveLength(1);
  });

  it('never downgrades an active row when the bank is still submitting', async () => {
    db.customer_direct_debits = [pending({ status: 'active' })];
    mandate('submitted');
    await run(fakeAdmin(), mandateEvent('submitted'));
    expect(db.customer_direct_debits[0].status).toBe('active');
  });

  it('failed → inactive; the push wording depends on whether it was active', async () => {
    db.customer_direct_debits = [pending()];
    mandate('failed');
    await run(fakeAdmin(), mandateEvent('failed'));
    expect(pushes[0]).toMatchObject({ title: 'Direct Debit not set up', body: "Jane Wright: their bank didn't accept it" });

    pushes.length = 0;
    db.customer_direct_debits = [pending({ status: 'active' })];
    mandate('expired');
    await run(fakeAdmin(), mandateEvent('expired'));
    expect(pushes[0].title).toBe('Direct Debit stopped');
    expect(db.customer_direct_debits[0].inactive_reason).toBe('Not used for over a year, so it expired');
  });

  it('cancelled: by the customer, the bank closing it, or the trader (no push)', async () => {
    mandate('cancelled');
    db.customer_direct_debits = [pending({ status: 'active' })];
    await run(fakeAdmin(), mandateEvent('cancelled', { details: { origin: 'bank', cause: 'mandate_cancelled' } }));
    expect(db.customer_direct_debits[0]).toMatchObject({ status: 'cancelled', cancelled_by: 'customer' });
    expect(pushes[0]).toMatchObject({ title: 'Direct Debit cancelled', body: 'Jane Wright cancelled their Direct Debit' });

    pushes.length = 0;
    db.customer_direct_debits = [pending({ status: 'active' })];
    await run(fakeAdmin(), mandateEvent('cancelled', { details: { origin: 'bank', cause: 'bank_account_closed' } }));
    expect(db.customer_direct_debits[0].cancelled_by).toBe('bank');
    expect(pushes[0].body).toBe("Jane Wright's Direct Debit stopped — their bank closed it");

    pushes.length = 0;
    db.customer_direct_debits = [pending({ status: 'active' })];
    await run(fakeAdmin(), mandateEvent('cancelled', { details: { origin: 'api', cause: 'mandate_cancelled' } }));
    expect(db.customer_direct_debits[0].cancelled_by).toBe('trader');
    expect(pushes).toHaveLength(0);
  });

  it('replaced points the row at the new mandate', async () => {
    db.customer_direct_debits = [pending({ status: 'active' })];
    gc['/mandates/MD2'] = { mandates: { id: 'MD2', status: 'active', links: {} } };
    await run(
      fakeAdmin(),
      ev({ resource_type: 'mandates', action: 'replaced', links: { organisation: 'OR1', mandate: 'MD1', new_mandate: 'MD2' } }),
    );
    expect(db.customer_direct_debits[0].gocardless_mandate_id).toBe('MD2');
    expect(db.customer_direct_debits[0].status).toBe('active');
  });

  it('transferred refreshes the bank details', async () => {
    db.customer_direct_debits = [pending({ status: 'active', bank_name: 'Old', account_number_ending: '00' })];
    mandate('active');
    await run(fakeAdmin(), mandateEvent('transferred'));
    expect(db.customer_direct_debits[0]).toMatchObject({ bank_name: 'Barclays', account_number_ending: '11' });
  });

  it('an unlinked mandate only updates its mandate link', async () => {
    db.gocardless_mandate_links = [{ tenant_id: TENANT, gocardless_mandate_id: 'MD1', mandate_status: 'active' }];
    mandate('cancelled');
    await run(fakeAdmin(), mandateEvent('cancelled'));
    expect(db.gocardless_mandate_links[0].mandate_status).toBe('cancelled');
    expect(pushes).toHaveLength(0);
  });
});

describe('payments', () => {
  const payEvent = (action: string) =>
    ev({ resource_type: 'payments', action, links: { organisation: 'OR1', payment: 'PM1' } });
  const gcPayment = (status: string, over: Row = {}) => {
    gc['/payments/PM1'] = {
      payments: {
        id: 'PM1',
        status,
        amount: 1500,
        amount_refunded: 0,
        charge_date: '2026-10-07',
        metadata: { workwise_collection_id: COLLECTION },
        links: { mandate: 'MD1' },
        ...over,
      },
    };
  };
  const collection = (over: Row = {}): Row => ({
    id: COLLECTION,
    tenant_id: TENANT,
    customer_id: CUSTOMER,
    direct_debit_id: 'dd-1',
    status: 'creating',
    amount: 15,
    payment_id: null,
    gocardless_payment_id: null,
    ...over,
  });

  it('submitted → processing with the charge date', async () => {
    db.direct_debit_collections = [collection()];
    gcPayment('submitted');
    await run(fakeAdmin(), payEvent('submitted'));
    expect(db.direct_debit_collections[0]).toMatchObject({
      status: 'processing',
      gocardless_payment_id: 'PM1',
      gocardless_status: 'submitted',
      charge_date: '2026-10-07',
    });
  });

  it('confirmed writes exactly one payment, even when replayed, and pushes once', async () => {
    db.direct_debit_collections = [collection({ status: 'processing' })];
    gcPayment('confirmed');
    const admin = fakeAdmin();
    await run(admin, payEvent('confirmed'));
    await run(admin, payEvent('confirmed'));
    expect(db.payments).toHaveLength(1);
    expect(db.payments[0]).toMatchObject({
      amount: 15,
      method: 'direct_debit',
      source: 'gocardless',
      status: 'active',
      gocardless_payment_id: 'PM1',
      recorded_by_user_id: null,
    });
    expect(db.direct_debit_collections[0]).toMatchObject({ status: 'succeeded', payment_id: db.payments[0].id });
    expect(pushes).toEqual([
      expect.objectContaining({ kind: 'dd_payment', title: 'Direct Debit received', body: '£15 from Jane Wright' }),
    ]);
  });

  it('a payment already recorded (crash between steps) finishes the collection without a second row', async () => {
    db.direct_debit_collections = [collection({ status: 'processing' })];
    db.payments = [{ id: 'pay-x', tenant_id: TENANT, gocardless_payment_id: 'PM1', amount: 15 }];
    gcPayment('paid_out');
    await run(fakeAdmin(), payEvent('paid_out'));
    expect(db.payments).toHaveLength(1);
    expect(db.direct_debit_collections[0]).toMatchObject({ status: 'succeeded', payment_id: 'pay-x' });
  });

  it('a database error recording the payment leaves the event unprocessed and the collection Collecting', async () => {
    db.direct_debit_collections = [collection({ status: 'processing' })];
    gcPayment('confirmed');
    failInsert.payments = { code: '57014' };
    const admin = fakeAdmin();
    const out = await run(admin, payEvent('confirmed'));
    expect(out).toEqual({ processed: 0, failed: 1 });
    expect(db.direct_debit_collections[0].status).toBe('processing');
    expect(db.gocardless_events[0].processed_at).toBeUndefined();
    expect(String(db.gocardless_events[0].last_error)).toContain('57014');
    expect(pushes).toHaveLength(0);
  });

  it('a refund already made is carried onto the new payment', async () => {
    db.direct_debit_collections = [collection({ status: 'processing' })];
    gcPayment('confirmed', { amount_refunded: 500 });
    await run(fakeAdmin(), payEvent('confirmed'));
    expect(db.payments[0].refunded_amount).toBe(5);
  });

  it('failed before collection → failed, and no payment', async () => {
    db.direct_debit_collections = [collection({ status: 'processing' })];
    gcPayment('failed');
    await run(
      fakeAdmin(),
      { ...payEvent('failed'), details: { cause: 'insufficient_funds', description: 'Not enough money' } },
    );
    expect(db.payments).toHaveLength(0);
    expect(db.direct_debit_collections[0]).toMatchObject({
      status: 'failed',
      failure_code: 'insufficient_funds',
      failure_message: 'Not enough money',
    });
    expect(afterCollectionFailed).toHaveBeenCalledTimes(1);
    expect(afterCollectionFailed).toHaveBeenCalledWith(expect.anything(), COLLECTION);
  });

  it('a submitted event handled after the payment already failed still records the real reason', async () => {
    db.direct_debit_collections = [collection({ status: 'processing' })];
    gcPayment('failed');
    gc['/events'] = {
      events: [
        { id: 'EV9', action: 'failed', details: { cause: 'insufficient_funds', description: 'Not enough money' } },
      ],
    };
    await run(fakeAdmin(), {
      ...payEvent('submitted'),
      details: { cause: 'payment_submitted', description: 'The payment has been submitted' },
    });
    expect(db.direct_debit_collections[0]).toMatchObject({
      status: 'failed',
      failure_code: 'insufficient_funds',
      failure_message: 'Not enough money',
    });
    expect(get).toHaveBeenCalledWith('/events', expect.objectContaining({ payment: 'PM1', action: 'failed' }));
    delete gc['/events'];
  });

  it('if the real reason cannot be read, the submitted reason is never used as the failure code', async () => {
    db.direct_debit_collections = [collection({ status: 'processing' })];
    gcPayment('failed');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await run(fakeAdmin(), {
      ...payEvent('submitted'),
      details: { cause: 'payment_submitted', description: 'The payment has been submitted' },
    });
    log.mockRestore();
    expect(db.direct_debit_collections[0].status).toBe('failed');
    expect(db.direct_debit_collections[0].failure_code).toBeNull();
  });

  it('a late failure voids the payment and fails the collection', async () => {
    db.direct_debit_collections = [collection({ status: 'succeeded', payment_id: 'pay-1' })];
    db.payments = [{ id: 'pay-1', tenant_id: TENANT, status: 'active', gocardless_payment_id: 'PM1', amount: 15 }];
    gcPayment('failed');
    const admin = fakeAdmin();
    await run(admin, payEvent('failed'));
    await run(admin, payEvent('failed'));
    expect(db.payments[0]).toMatchObject({ status: 'void', void_reason: 'Direct Debit failed after collection' });
    expect(db.direct_debit_collections[0].status).toBe('failed');
  });

  it('a failed collection the trader retried in GoCardless and that then confirms → succeeded, choice cleared', async () => {
    db.direct_debit_collections = [
      collection({
        status: 'failed',
        resolution: 'collect_again',
        resolved_at: '2026-09-30T10:00:00.000Z',
        resolved_by_user_id: 'user-1',
      }),
    ];
    gcPayment('confirmed');
    const admin = fakeAdmin();
    await run(admin, payEvent('confirmed'));
    await run(admin, payEvent('confirmed'));
    expect(db.payments).toHaveLength(1);
    expect(db.direct_debit_collections[0]).toMatchObject({
      status: 'succeeded',
      payment_id: db.payments[0].id,
      resolution: null,
      resolved_at: null,
      resolved_by_user_id: null,
    });
    expect(pushes.map((p) => p.title)).toEqual(['Direct Debit received']);
  });

  it('a chargeback never overwrites one already recorded as lost', async () => {
    db.direct_debit_collections = [collection({ status: 'succeeded', payment_id: 'pay-1', gocardless_status: 'charged_back' })];
    db.payments = [
      {
        id: 'pay-1',
        tenant_id: TENANT,
        status: 'active',
        gocardless_payment_id: 'PM1',
        amount: 15,
        refunded_amount: 15,
        dispute_status: 'lost',
        disputed_at: '2026-09-29T08:00:00.000Z',
      },
    ];
    gcPayment('charged_back');
    await run(fakeAdmin(), payEvent('charged_back'));
    expect(db.payments[0].disputed_at).toBe('2026-09-29T08:00:00.000Z');
    expect(pushes).toHaveLength(0);
  });

  it('cancelled before confirmation → cancelled', async () => {
    db.direct_debit_collections = [collection({ status: 'processing' })];
    gcPayment('cancelled');
    await run(fakeAdmin(), payEvent('cancelled'));
    expect(db.direct_debit_collections[0].status).toBe('cancelled');
  });

  it('charged back → refunded in full, disputed, one instant push; chargeback cancelled → won', async () => {
    db.direct_debit_collections = [collection({ status: 'succeeded', payment_id: 'pay-1', gocardless_status: 'confirmed' })];
    db.payments = [
      { id: 'pay-1', tenant_id: TENANT, status: 'active', gocardless_payment_id: 'PM1', amount: 15, refunded_amount: 0 },
    ];
    gcPayment('charged_back');
    const admin = fakeAdmin();
    await run(admin, payEvent('charged_back'));
    await run(admin, payEvent('charged_back'));
    expect(db.payments[0]).toMatchObject({ dispute_status: 'lost', refunded_amount: 15 });
    expect(db.payments[0].disputed_at).toBe('2026-10-01T09:59:00.000Z');
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({
      kind: 'dd_failed',
      title: 'Direct Debit reclaimed',
      body: "Jane Wright reclaimed £15 from their bank. It's owed again.",
    });

    gcPayment('chargeback_cancelled', { amount_refunded: 0 });
    await run(admin, payEvent('chargeback_cancelled'));
    expect(db.payments[0]).toMatchObject({ dispute_status: 'won', refunded_amount: 0 });
  });

  it('reclaimed before the payment was ever recorded → paid, then reclaimed, and owed again', async () => {
    db.direct_debit_collections = [collection({ status: 'processing' })];
    gcPayment('charged_back');
    await run(fakeAdmin(), payEvent('confirmed'));
    expect(db.payments).toHaveLength(1);
    expect(db.payments[0]).toMatchObject({ method: 'direct_debit', dispute_status: 'lost', refunded_amount: 15 });
    expect(db.direct_debit_collections[0]).toMatchObject({ status: 'succeeded', gocardless_status: 'charged_back' });
    expect(pushes.map((p) => p.title)).toEqual(['Direct Debit received', 'Direct Debit reclaimed']);
  });

  it('a Pay by Bank payment never becomes a collection or an "another app" warning', async () => {
    db.gocardless_pay_requests = [{ id: 'pr-1', tenant_id: TENANT, gocardless_payment_id: 'PM1' }];
    db.customer_direct_debits = [ddRow({ status: 'active', source: 'imported', gocardless_mandate_id: 'MD1' })];
    gcPayment('submitted', { metadata: {} });
    await run(fakeAdmin(), payEvent('submitted'));
    expect(pushes).toHaveLength(0);
    expect(db.payments).toHaveLength(0);
  });

  it('a payment WorkWise did not make on a linked Direct Debit warns once a day, and is never recorded', async () => {
    db.customer_direct_debits = [ddRow({ status: 'active', source: 'imported', gocardless_mandate_id: 'MD1' })];
    gcPayment('submitted', { metadata: {} });
    const admin = fakeAdmin();
    await run(admin, payEvent('submitted'));
    await run(admin, { ...payEvent('submitted') });
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({ kind: 'dd_attention', title: 'Another app is collecting' });
    expect(pushes[0].body).toContain('Jane Wright');
    expect(db.payments).toHaveLength(0);
  });

  it('a foreign payment already paid out by the time the webhook is handled still warns — but only for its creation', async () => {
    db.customer_direct_debits = [ddRow({ status: 'active', source: 'imported', gocardless_mandate_id: 'MD1' })];
    gcPayment('paid_out', { metadata: {} });
    const admin = fakeAdmin();
    await run(admin, payEvent('confirmed'));
    expect(pushes).toHaveLength(0);
    await run(admin, payEvent('created'));
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({ kind: 'dd_attention', title: 'Another app is collecting' });
    expect(db.payments).toHaveLength(0);
  });

  it('a foreign payment on a mandate WorkWise did not link is ignored', async () => {
    gcPayment('submitted', { metadata: {} });
    await run(fakeAdmin(), payEvent('submitted'));
    expect(pushes).toHaveLength(0);
  });
});

describe('refunds', () => {
  const refundEvent = (action: string) =>
    ev({ resource_type: 'refunds', action, links: { organisation: 'OR1', refund: 'RF1' } });
  beforeEach(() => {
    db.payments = [
      { id: 'pay-1', tenant_id: TENANT, gocardless_payment_id: 'PM1', amount: 15, refunded_amount: 0 },
    ];
    gc['/refunds/RF1'] = { refunds: { id: 'RF1', links: { payment: 'PM1' } } };
  });
  const payment = (refunded: number) => {
    gc['/payments/PM1'] = { payments: { id: 'PM1', amount: 1500, amount_refunded: refunded } };
  };

  it('a refund raises the refunded amount; a failed refund lowers it again', async () => {
    const admin = fakeAdmin();
    payment(500);
    await run(admin, refundEvent('created'));
    expect(db.payments[0].refunded_amount).toBe(5);

    payment(0);
    await run(admin, refundEvent('paid'));
    expect(db.payments[0].refunded_amount).toBe(5);
    await run(admin, refundEvent('failed'));
    expect(db.payments[0].refunded_amount).toBe(0);
  });

  it('never refunds more than the payment', async () => {
    payment(9999);
    await run(fakeAdmin(), refundEvent('created'));
    expect(db.payments[0].refunded_amount).toBe(15);
  });

  it('a refund on a payment WorkWise does not have is ignored', async () => {
    db.payments = [];
    payment(500);
    const out = await run(fakeAdmin(), refundEvent('created'));
    expect(out).toEqual({ processed: 1, failed: 0 });
  });
});

describe('creditors and disconnection', () => {
  it('a creditor slipping from successful to action_required warns the trader', async () => {
    refreshVerification.mockResolvedValue({ status: 'connected', verification_status: 'action_required' });
    await run(fakeAdmin(), ev({ resource_type: 'creditors', action: 'updated', links: { organisation: 'OR1', creditor: 'CR1' } }));
    expect(refreshVerification).toHaveBeenCalledWith(expect.anything(), TENANT, expect.objectContaining({ force: true }));
    expect(pushes[0]).toMatchObject({ kind: 'dd_attention', title: 'GoCardless needs more details' });
  });

  it('a creditor that stays fine sends nothing', async () => {
    refreshVerification.mockResolvedValue({ status: 'connected', verification_status: 'successful' });
    await run(fakeAdmin(), ev({ resource_type: 'creditors', action: 'updated', links: { organisation: 'OR1', creditor: 'CR1' } }));
    expect(pushes).toHaveLength(0);
  });

  it('organisations/disconnected marks the connection off and warns', async () => {
    await run(
      fakeAdmin(),
      ev({ id: null, resource_type: 'organisations', action: 'disconnected', links: { organisation: 'OR1' } }),
    );
    expect(markDisconnected).toHaveBeenCalledWith(expect.anything(), TENANT, 'GoCardless access was removed');
    expect(pushes[0]).toMatchObject({ kind: 'dd_attention', title: 'GoCardless disconnected' });
  });

  it("stays quiet when WorkWise's own Disconnect already turned it off", async () => {
    connection.value = { status: 'disconnected' };
    await run(
      fakeAdmin(),
      ev({ id: null, resource_type: 'organisations', action: 'disconnected', links: { organisation: 'OR1' } }),
    );
    expect(markDisconnected).not.toHaveBeenCalled();
    expect(pushes).toHaveLength(0);
  });

  it('a revoked token during processing marks disconnected and finishes the event', async () => {
    get.mockRejectedValueOnce(
      new GoCardlessError({ message: 'revoked', status: 401, reasons: ['access_token_revoked'] }),
    );
    const out = await run(fakeAdmin(), ev({ resource_type: 'mandates', action: 'active', links: { organisation: 'OR1', mandate: 'MD1' } }));
    expect(out).toEqual({ processed: 1, failed: 0 });
    expect(markDisconnected).toHaveBeenCalled();
  });

  it('a connected business whose connection can\'t be opened keeps the event for a retry', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    unlockable.value = false;
    const admin = fakeAdmin();
    const event = ev({ resource_type: 'payments', action: 'confirmed', links: { organisation: 'OR1', payment: 'PM1' } });

    storedStatus.value = 'connected';
    expect(await run(admin, event)).toEqual({ processed: 0, failed: 1 });
    storedStatus.value = new Error('db down');
    expect(await processGoCardlessEvents(admin, { ids: [event.id as string], now: NOW })).toEqual({
      processed: 0,
      failed: 1,
    });
    expect(db.gocardless_events[0].processed_at ?? null).toBeNull();

    // Really disconnected → nothing more can be read; the event is finished.
    storedStatus.value = 'disconnected';
    expect(await processGoCardlessEvents(admin, { ids: [event.id as string], now: NOW })).toEqual({
      processed: 1,
      failed: 0,
    });
    errorLog.mockRestore();
  });

  it('unknown resource types are stored and marked processed', async () => {
    const out = await run(fakeAdmin(), ev({ resource_type: 'instalment_schedules', action: 'created' }));
    expect(out).toEqual({ processed: 1, failed: 0 });
    expect(db.gocardless_events[0].processed_at).toBe(NOW.toISOString());
  });
});

describe('retries', () => {
  it('sweeps unprocessed events older than the cutoff, and gives up after 10 attempts', async () => {
    const admin = fakeAdmin();
    gc['/mandates/MD1'] = undefined as never;
    delete gc['/mandates/MD1'];
    const event = ev({ resource_type: 'mandates', action: 'active', links: { organisation: 'OR1', mandate: 'MD1' } });
    await storeGoCardlessEvents(admin, [event]);
    db.gocardless_events[0].received_at = '2026-10-01T09:50:00.000Z';
    db.gocardless_events[0].attempts = 8;

    const first = await processGoCardlessEvents(admin, { now: NOW });
    expect(first).toEqual({ processed: 0, failed: 1 });
    expect(db.gocardless_events[0]).toMatchObject({ attempts: 9 });
    expect(db.gocardless_events[0].processed_at).toBeUndefined();

    const second = await processGoCardlessEvents(admin, { now: NOW });
    expect(second.failed).toBe(1);
    expect(db.gocardless_events[0].processed_at).toBe(NOW.toISOString());
    expect(String(db.gocardless_events[0].last_error)).toMatch(/^gave up: /);

    expect(await processGoCardlessEvents(admin, { now: NOW })).toEqual({ processed: 0, failed: 0 });
  });

  it('leaves events younger than the cutoff to the webhook that stored them', async () => {
    const admin = fakeAdmin();
    await storeGoCardlessEvents(admin, [ev({ resource_type: 'mandates', action: 'active', links: { organisation: 'OR1', mandate: 'MD1' } })]);
    db.gocardless_events[0].received_at = '2026-10-01T09:59:30.000Z';
    expect(await processGoCardlessEvents(admin, { now: NOW })).toEqual({ processed: 0, failed: 0 });
  });
});

describe('refreshCollection', () => {
  const COL = '55555555-5555-5555-5555-555555555555';
  const collectionRow = (over: Row = {}): Row => ({
    id: COL,
    tenant_id: TENANT,
    customer_id: CUSTOMER,
    status: 'processing',
    gocardless_status: 'submitted',
    gocardless_payment_id: 'PM1',
    payment_id: null,
    ...over,
  });
  const gcPay = (status: string) => {
    gc['/payments/PM1'] = {
      payments: { id: 'PM1', status, amount: 1500, amount_refunded: 0, metadata: { workwise_collection_id: COL }, links: { mandate: 'MD1' } },
    };
  };

  it('applies a missed confirmation once and reports updated, then unchanged', async () => {
    db.direct_debit_collections = [collectionRow()];
    gcPay('confirmed');
    const admin = fakeAdmin();
    expect(await refreshCollection(admin, COL)).toBe('updated');
    expect(db.payments).toHaveLength(1);
    expect(db.direct_debit_collections[0].status).toBe('succeeded');
    expect(await refreshCollection(admin, COL)).toBe('unchanged');
    expect(db.payments).toHaveLength(1);
  });

  it('unchanged when GoCardless still says the same; failed when GoCardless errors; never throws', async () => {
    db.direct_debit_collections = [collectionRow({ gocardless_status: 'submitted' })];
    gcPay('submitted');
    expect(await refreshCollection(fakeAdmin(), COL)).toBe('unchanged');

    delete gc['/payments/PM1'];
    expect(await refreshCollection(fakeAdmin(), COL)).toBe('failed');
  });

  it('unchanged for a collection GoCardless never heard of', async () => {
    db.direct_debit_collections = [collectionRow({ gocardless_payment_id: null })];
    expect(await refreshCollection(fakeAdmin(), COL)).toBe('unchanged');
    expect(get).not.toHaveBeenCalled();
  });
});
