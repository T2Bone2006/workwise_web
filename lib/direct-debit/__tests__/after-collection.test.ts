import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const TENANT = '11111111-1111-1111-1111-111111111111';
const CUSTOMER = '33333333-3333-3333-3333-333333333333';
const USER = '99999999-9999-9999-9999-999999999999';

const pushes: { kind: string; title: string; body: string; data: unknown }[] = [];
const sent: Record<string, unknown>[] = [];
const collectForCustomer = vi.fn();
const action = vi.fn();
const connected = { value: true };
const sendOutcome = { value: { outcome: 'email_sent', messageId: 'm1' } as Record<string, unknown> };

vi.mock('@/lib/push/owner-push', () => ({
  sendOrHoldOwnerPush: async (_a: unknown, _t: string, p: { kind: string; title: string; body: string; data: unknown }) => {
    pushes.push(p);
    return 'sent';
  },
}));
vi.mock('@/lib/direct-debit/collect', () => ({
  collectForCustomer: (...a: unknown[]) => collectForCustomer(...a),
}));
vi.mock('@/lib/gocardless/connection', () => ({
  clientForTenant: async () => (connected.value ? { client: { action }, connection: {} } : null),
}));
vi.mock('@/lib/messaging/send', () => ({
  sendCustomerMessage: async (input: Record<string, unknown>) => {
    sent.push(input);
    return sendOutcome.value;
  },
}));
vi.mock('@/lib/messaging/brand', () => ({
  getTenantMessagingContext: async () => ({
    tenantId: TENANT,
    businessName: 'Sparkle Windows',
    contactPhone: '+447700900123',
    replyToEmail: null,
    logoUrl: null,
    settings: {},
  }),
}));
vi.mock('@/lib/payments/money-core', () => ({
  ensurePayLinkToken: async () => 'tok_abcdefghijklmnopqrstuvwxyz',
}));
vi.mock('@/lib/payments/tokens', () => ({
  payLinkUrl: (t: string) => `https://app.joinworkwise.com/pay/${t}`,
}));

import { GoCardlessError } from '@/lib/gocardless/client';
import {
  afterCollectionFailed,
  cancelDirectDebit,
  failureReasonText,
  resolveFailedCollection,
} from '@/lib/direct-debit/after-collection';

type Row = Record<string, unknown>;
let db: Record<string, Row[]>;
const failUpdate = { table: null as string | null };

function fakeAdmin(): SupabaseClient {
  const from = (table: string) => {
    db[table] ??= [];
    const rows = db[table];
    let op: 'select' | 'update' = 'select';
    let payload: Row = {};
    const filters: ((r: Row) => boolean)[] = [];
    const run = (single: boolean) => {
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === 'update') {
        if (failUpdate.table === table) return { data: null, error: { code: 'XX000' } };
        for (const r of hit) Object.assign(r, payload);
        return { data: hit, error: null };
      }
      return { data: single ? (hit[0] ?? null) : hit, error: null };
    };
    const b = {
      select: () => b,
      update: (row: Row) => ((op = 'update'), (payload = row), b),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), b),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
      maybeSingle: async () => run(true),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run(false)).then(res, rej),
    };
    return b;
  };
  return { from } as unknown as SupabaseClient;
}

const COL = '44444444-4444-4444-4444-444444444444';
const failedCollection = (over: Row = {}): Row => ({
  id: COL,
  tenant_id: TENANT,
  customer_id: CUSTOMER,
  direct_debit_id: 'dd-1',
  amount: 15,
  status: 'failed',
  resolution: null,
  failure_code: 'insufficient_funds',
  finished_at: new Date(Date.now() - 60_000).toISOString(),
  ...over,
});

beforeEach(() => {
  db = {
    customers: [{ id: CUSTOMER, tenant_id: TENANT, name: 'Jane Wright', email: 'jane@example.com' }],
    customer_direct_debits: [
      { id: 'dd-1', tenant_id: TENANT, customer_id: CUSTOMER, status: 'active', source: 'workwise', gocardless_mandate_id: 'MD1' },
    ],
    direct_debit_collections: [failedCollection()],
    gocardless_mandate_links: [],
  };
  pushes.length = 0;
  sent.length = 0;
  collectForCustomer.mockReset();
  action.mockReset();
  action.mockResolvedValue({});
  connected.value = true;
  failUpdate.table = null;
  sendOutcome.value = { outcome: 'email_sent', messageId: 'm1' };
});

describe('failureReasonText', () => {
  it.each([
    ['insufficient_funds', 'not enough money in their account'],
    ['refer_to_payer', 'their bank refused it'],
    ['bank_account_closed', 'their account is closed'],
    ['mandate_cancelled', 'they cancelled the Direct Debit'],
    ['authorisation_disputed', 'they cancelled the Direct Debit'],
    ['something_new', "their bank didn't pay it"],
    [null, "their bank didn't pay it"],
  ])('%s', (code, text) => {
    expect(failureReasonText(code)).toBe(text);
  });
});

describe('afterCollectionFailed', () => {
  it('pushes the trader and messages the customer with the pay link', async () => {
    await afterCollectionFailed(fakeAdmin(), COL);
    expect(pushes).toEqual([
      {
        kind: 'dd_failed',
        title: 'Direct Debit failed',
        body: "Jane Wright: £15 wasn't collected — not enough money in their account. Collect again or leave it?",
        data: { type: 'dd_failed', amount: 15, customerId: CUSTOMER, customerName: 'Jane Wright' },
      },
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      tenantId: TENANT,
      customerId: CUSTOMER,
      kind: 'dd_failed',
      dedupeKey: `dd_failed:${COL}`,
    });
    expect((sent[0].text as () => string)()).toContain("we couldn't collect £15.00 by Direct Debit");
    expect((sent[0].text as () => string)()).toContain('/pay/tok_abcdefghijklmnopqrstuvwxyz');
    expect(sent[0].email).toBeTypeOf('function');
  });

  it('a customer with no email gets the text only', async () => {
    db.customers[0].email = null;
    await afterCollectionFailed(fakeAdmin(), COL);
    expect(sent[0].email).toBeNull();
  });

  it('a second call an hour later does not push again, and the message dedupe key is the same', async () => {
    db.direct_debit_collections[0].finished_at = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    await afterCollectionFailed(fakeAdmin(), COL);
    expect(pushes).toHaveLength(0);
    expect(sent[0].dedupeKey).toBe(`dd_failed:${COL}`);
  });

  it("does nothing unless the collection is 'failed'", async () => {
    db.direct_debit_collections[0].status = 'processing';
    await afterCollectionFailed(fakeAdmin(), COL);
    expect(pushes).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('never throws, and a failing message does not lose the push', async () => {
    const boom = vi.spyOn(console, 'error').mockImplementation(() => {});
    sendOutcome.value = { outcome: 'failed', error: 'no' };
    await expect(afterCollectionFailed(fakeAdmin(), COL)).resolves.toBeUndefined();
    expect(pushes).toHaveLength(1);
    await expect(afterCollectionFailed({ from: () => { throw new Error('db'); } } as unknown as SupabaseClient, COL)).resolves.toBeUndefined();
    boom.mockRestore();
  });
});

describe('resolveFailedCollection', () => {
  const base = { tenantId: TENANT, userId: USER, collectionId: COL };

  it('leave → resolved, nothing collected', async () => {
    const out = await resolveFailedCollection(fakeAdmin(), { ...base, action: 'leave' });
    expect(out).toEqual({ ok: true, newCollectionId: null });
    expect(db.direct_debit_collections[0]).toMatchObject({ resolution: 'left', resolved_by_user_id: USER });
    expect(db.direct_debit_collections[0].resolved_at).toBeTruthy();
    expect(collectForCustomer).not.toHaveBeenCalled();
  });

  it('collect again → resolves first, then collects the same amount as the trader', async () => {
    collectForCustomer.mockImplementation(async () => {
      expect(db.direct_debit_collections[0].resolution).toBe('collect_again');
      return { kind: 'created', collectionId: 'new-1', amount: 15 };
    });
    const out = await resolveFailedCollection(fakeAdmin(), { ...base, action: 'collect_again' });
    expect(out).toEqual({ ok: true, newCollectionId: 'new-1' });
    expect(collectForCustomer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: TENANT, customerId: CUSTOMER, createdBy: 'trader', userId: USER, amount: 15 }),
    );
  });

  it("they've paid meanwhile → stays resolved, no new collection", async () => {
    collectForCustomer.mockResolvedValue({ kind: 'skipped', reason: 'nothing_to_collect' });
    const out = await resolveFailedCollection(fakeAdmin(), { ...base, action: 'collect_again' });
    expect(out).toEqual({ ok: true, newCollectionId: null });
    expect(db.direct_debit_collections[0].resolution).toBe('collect_again');
  });

  it('no Direct Debit any more → reverted with the pay-link message', async () => {
    collectForCustomer.mockResolvedValue({ kind: 'skipped', reason: 'no_direct_debit' });
    const out = await resolveFailedCollection(fakeAdmin(), { ...base, action: 'collect_again' });
    expect(out).toEqual({ ok: false, error: "Their Direct Debit isn't active any more — send them the pay link instead." });
    expect(db.direct_debit_collections[0]).toMatchObject({ resolution: null, resolved_at: null, resolved_by_user_id: null });
  });

  it.each([
    [{ kind: 'skipped', reason: 'busy' }],
    [{ kind: 'error', collectionId: null, message: 'x' }],
    [{ kind: 'too_large', amount: 2000 }],
    [{ kind: 'other_app', detail: 'y' }],
  ])('%o → reverted with the try-again message', async (outcome) => {
    collectForCustomer.mockResolvedValue(outcome);
    const out = await resolveFailedCollection(fakeAdmin(), { ...base, action: 'collect_again' });
    expect(out).toEqual({ ok: false, error: "Couldn't start the collection. Try again in a minute." });
    expect(db.direct_debit_collections[0].resolution).toBeNull();
  });

  it('a collect call that throws is reverted too', async () => {
    const boom = vi.spyOn(console, 'error').mockImplementation(() => {});
    collectForCustomer.mockRejectedValue(new Error('boom'));
    const out = await resolveFailedCollection(fakeAdmin(), { ...base, action: 'collect_again' });
    expect(out.ok).toBe(false);
    expect(db.direct_debit_collections[0].resolution).toBeNull();
    boom.mockRestore();
  });

  it('already sorted, someone else\'s, or not failed → "already been sorted", nothing collected', async () => {
    const admin = fakeAdmin();
    await resolveFailedCollection(admin, { ...base, action: 'leave' });
    for (const p of [
      { ...base, action: 'collect_again' as const },
      { ...base, tenantId: 'other', action: 'leave' as const },
    ]) {
      expect(await resolveFailedCollection(admin, p)).toEqual({ ok: false, error: 'This has already been sorted.' });
    }
    db.direct_debit_collections[0] = failedCollection({ status: 'succeeded' });
    expect(await resolveFailedCollection(admin, { ...base, action: 'leave' })).toEqual({
      ok: false,
      error: 'This has already been sorted.',
    });
    expect(collectForCustomer).not.toHaveBeenCalled();
  });

  it('a database error saving the choice collects nothing', async () => {
    failUpdate.table = 'direct_debit_collections';
    const out = await resolveFailedCollection(fakeAdmin(), { ...base, action: 'collect_again' });
    expect(out.ok).toBe(false);
    expect(collectForCustomer).not.toHaveBeenCalled();
  });
});

describe('cancelDirectDebit', () => {
  const p = { tenantId: TENANT, userId: USER, customerId: CUSTOMER };

  it('cancels the one mandate in GoCardless and in WorkWise, and reports what is still collecting', async () => {
    db.direct_debit_collections = [
      failedCollection({ id: 'c-proc', status: 'processing', amount: 15 }),
      failedCollection({ id: 'c-proc2', status: 'processing', amount: 5.5 }),
      failedCollection({ id: 'c-done', status: 'succeeded', amount: 99 }),
    ];
    const out = await cancelDirectDebit(fakeAdmin(), p);
    expect(out).toEqual({ ok: true, stillCollecting: 20.5 });
    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith('/mandates/MD1/actions/cancel');
    expect(db.customer_direct_debits[0]).toMatchObject({ status: 'cancelled', cancelled_by: 'trader' });
    expect(db.customer_direct_debits[0].cancelled_at).toBeTruthy();
  });

  it('survives GoCardless saying it is already cancelled, or being unreachable, or not connected', async () => {
    const boom = vi.spyOn(console, 'error').mockImplementation(() => {});
    action.mockRejectedValueOnce(new GoCardlessError({ message: 'invalid state', status: 422, type: 'invalid_state', reasons: ['mandate_is_inactive'] }));
    expect((await cancelDirectDebit(fakeAdmin(), p)).ok).toBe(true);
    expect(db.customer_direct_debits[0].status).toBe('cancelled');

    db.customer_direct_debits[0].status = 'active';
    action.mockRejectedValueOnce(new Error('network'));
    expect((await cancelDirectDebit(fakeAdmin(), p)).ok).toBe(true);
    expect(db.customer_direct_debits[0].status).toBe('cancelled');

    db.customer_direct_debits[0].status = 'active';
    connected.value = false;
    expect((await cancelDirectDebit(fakeAdmin(), p)).ok).toBe(true);
    expect(db.customer_direct_debits[0].status).toBe('cancelled');
    boom.mockRestore();
  });

  it('no active Direct Debit, or another business\'s customer → error, nothing cancelled', async () => {
    expect(await cancelDirectDebit(fakeAdmin(), { ...p, tenantId: 'other' })).toEqual({ ok: false, error: 'No active Direct Debit.' });
    db.customer_direct_debits[0].status = 'cancelled';
    expect(await cancelDirectDebit(fakeAdmin(), p)).toEqual({ ok: false, error: 'No active Direct Debit.' });
    expect(action).not.toHaveBeenCalled();
  });

  it('an imported Direct Debit is marked ignored so Check again does not offer it back', async () => {
    db.customer_direct_debits[0].source = 'imported';
    db.gocardless_mandate_links = [
      { tenant_id: TENANT, gocardless_mandate_id: 'MD1', decision: 'linked' },
      { tenant_id: TENANT, gocardless_mandate_id: 'MD2', decision: 'pending' },
    ];
    await cancelDirectDebit(fakeAdmin(), p);
    expect(db.gocardless_mandate_links.map((r) => r.decision)).toEqual(['ignored', 'pending']);
  });

  it('a WorkWise-made Direct Debit leaves the mandate links alone', async () => {
    db.gocardless_mandate_links = [{ tenant_id: TENANT, gocardless_mandate_id: 'MD1', decision: 'linked' }];
    await cancelDirectDebit(fakeAdmin(), p);
    expect(db.gocardless_mandate_links[0].decision).toBe('linked');
  });
});
