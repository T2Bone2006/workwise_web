import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const TENANT = '11111111-1111-1111-1111-111111111111';
const CUSTOMER = '33333333-3333-3333-3333-333333333333';
const INVOICE = '55555555-5555-5555-5555-555555555555';
const TOKEN = 'tok_abcdefghijklmnopqrstuvwxyz';

const post = vi.fn();
const get = vi.fn();
const ddState = { value: 'on' };
const connected = { value: true };
const numbers = { owed: 15, collecting: 0, heldFailed: 0, payingByBank: 0, left: 0 };
const customerPage = { value: null as Record<string, unknown> | null };
const invoicePage = { value: null as Record<string, unknown> | null };
const notice = vi.fn();
const pushes: { kind: string; title: string; body: string }[] = [];

vi.mock('@/lib/data/payments/public-pay', () => ({
  loadCustomerPayPage: async () => customerPage.value,
  loadInvoiceByToken: async () => invoicePage.value,
}));
vi.mock('@/lib/direct-debit/state', () => ({ getDirectDebitState: async () => ddState.value }));
vi.mock('@/lib/direct-debit/collect', async () => {
  const actual = await vi.importActual<typeof import('@/lib/direct-debit/collect')>('@/lib/direct-debit/collect').catch(() => null);
  return {
    loadCollectionNumbers: async () => ({ ...numbers }),
    amountToCollect: (p: { owed: number; collecting: number; heldFailed: number; payingByBank: number }) =>
      actual?.amountToCollect
        ? actual.amountToCollect(p)
        : Math.max(0, Math.round((p.owed - p.collecting - p.heldFailed - p.payingByBank) * 100) / 100),
  };
});
vi.mock('@/lib/direct-debit/setup', () => ({
  prefilledCustomerFor: async () => ({ given_name: 'Jane', family_name: 'Wright', country_code: 'GB' }),
}));
vi.mock('@/lib/gocardless/connection', () => ({
  clientForTenant: async () =>
    connected.value ? { client: { post, get }, connection: { organisation_id: 'OR1', status: 'connected' } } : null,
}));
vi.mock('@/lib/payments/notify', () => ({ sendPaymentReceivedNotice: (...a: unknown[]) => notice(...a) }));
vi.mock('@/lib/payments/tokens', () => ({ appBaseUrl: () => 'https://app.joinworkwise.com' }));
vi.mock('@/lib/push/owner-push', () => ({
  sendOrHoldOwnerPush: async (_a: unknown, _t: string, p: { kind: string; title: string; body: string }) => {
    pushes.push(p);
    return 'sent';
  },
}));

import { GoCardlessError } from '@/lib/gocardless/client';
import { onPayRequestFulfilled, onPayRequestPayment, startPayByBank } from '@/lib/gocardless/pay-by-bank';

type Row = Record<string, unknown>;
let db: Record<string, Row[]>;
let nextId = 1;
const failInsert = { table: null as string | null, code: 'XX000' };

function fakeAdmin(): SupabaseClient {
  const from = (table: string) => {
    db[table] ??= [];
    const rows = db[table];
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: Row = {};
    const filters: ((r: Row) => boolean)[] = [];
    let max = Infinity;
    const run = (single: boolean) => {
      if (op === 'insert') {
        if (failInsert.table === table) return { data: null, error: { code: failInsert.code } };
        const row: Row = { id: `id-${nextId++}`, ...payload };
        const uniques: Record<string, string[]> = {
          payments: ['gocardless_payment_id'],
          gocardless_pay_requests: ['gocardless_billing_request_id'],
        };
        for (const col of uniques[table] ?? []) {
          if (row[col] != null && rows.some((r) => r[col] === row[col])) return { data: null, error: { code: '23505' } };
        }
        rows.push(row);
        return { data: row, error: null };
      }
      const hit = rows.filter((r) => filters.every((f) => f(r))).slice(0, max);
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
    const b = {
      select: () => b,
      insert: (row: Row) => ((op = 'insert'), (payload = row), b),
      update: (row: Row) => ((op = 'update'), (payload = row), b),
      delete: () => ((op = 'delete'), b),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
      neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), b),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), b),
      limit: (n: number) => ((max = n), b),
      maybeSingle: async () => run(true),
      single: async () => run(true),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run(false)).then(res, rej),
    };
    return b;
  };
  return { from } as unknown as SupabaseClient;
}

beforeEach(() => {
  db = {
    customers: [{ id: CUSTOMER, tenant_id: TENANT, name: 'Jane Wright' }],
    customer_direct_debits: [],
    gocardless_pay_requests: [],
    payments: [],
  };
  post.mockReset();
  get.mockReset();
  notice.mockReset();
  pushes.length = 0;
  ddState.value = 'on';
  connected.value = true;
  Object.assign(numbers, { owed: 15, collecting: 0, heldFailed: 0, payingByBank: 0, left: 0 });
  failInsert.table = null;
  customerPage.value = {
    business: { tenantId: TENANT, name: 'Sparkle Windows' },
    customerId: CUSTOMER,
  };
  invoicePage.value = {
    business: { tenantId: TENANT, name: 'Sparkle Windows' },
    invoice: { id: INVOICE, customerId: CUSTOMER, status: 'issued', balanceDue: 42.5 },
  };
  post.mockImplementation(async (path: string) =>
    path === '/billing_requests'
      ? { billing_requests: { id: `BRQ${nextId++}` } }
      : { billing_request_flows: { authorisation_url: 'https://pay.gocardless.com/flow/1' } },
  );
  notice.mockResolvedValue({ outcome: 'sent' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const customerStart = (kind: 'pay_by_bank' | 'pay_and_dd' = 'pay_by_bank') =>
  startPayByBank(fakeAdmin(), { from: 'customer', payToken: TOKEN, kind });

describe('startPayByBank', () => {
  it('customer: makes the billing request with only a payment request, and the flow, and returns the page', async () => {
    const out = await customerStart();
    expect(out).toEqual({ ok: true, url: 'https://pay.gocardless.com/flow/1' });
    const [path, body, opts] = post.mock.calls[0];
    expect(path).toBe('/billing_requests');
    expect(body.billing_requests.payment_request).toEqual({ amount: 1500, currency: 'GBP', description: 'Sparkle Windows' });
    expect(body.billing_requests.mandate_request).toBeUndefined();
    expect(body.billing_requests.metadata).toEqual({
      workwise_tenant_id: TENANT,
      workwise_customer_id: CUSTOMER,
      workwise_kind: 'pay_by_bank',
    });
    expect(opts.idempotencyKey).toMatch(/^pbb_/);
    const flow = post.mock.calls[1];
    expect(flow[0]).toBe('/billing_request_flows');
    expect(flow[1].billing_request_flows.redirect_uri).toBe(`https://app.joinworkwise.com/pay/${TOKEN}?bank=done`);
    expect(flow[1].billing_request_flows.exit_uri).toBe(`https://app.joinworkwise.com/pay/${TOKEN}?bank=cancelled`);
    expect(flow[1].billing_request_flows.prefilled_customer.given_name).toBe('Jane');
    expect(db.gocardless_pay_requests[0]).toMatchObject({
      tenant_id: TENANT,
      customer_id: CUSTOMER,
      kind: 'pay_by_bank',
      amount: 15,
      status: 'started',
      gocardless_organisation_id: 'OR1',
    });
    expect(db.customer_direct_debits).toHaveLength(0);
  });

  it('the amount is worked out on the server: owed minus collecting and approved bank payments; a failure does not block it', async () => {
    Object.assign(numbers, { owed: 40, collecting: 10, payingByBank: 5, heldFailed: 15, left: 15 });
    await customerStart();
    expect(post.mock.calls[0][1].billing_requests.payment_request.amount).toBe(2500);
  });

  it('pay_and_dd adds the mandate request and a setting-up Direct Debit row', async () => {
    db.customer_direct_debits = [{ id: 'old', tenant_id: TENANT, customer_id: CUSTOMER, status: 'setting_up' }];
    const out = await customerStart('pay_and_dd');
    expect(out.ok).toBe(true);
    const body = post.mock.calls[0][1].billing_requests;
    expect(body.payment_request.amount).toBe(1500);
    expect(body.mandate_request).toEqual({ scheme: 'bacs', currency: 'GBP' });
    expect(body.metadata.workwise_kind).toBe('pay_and_dd');
    expect(db.customer_direct_debits).toHaveLength(1);
    expect(db.customer_direct_debits[0]).toMatchObject({ status: 'setting_up', source: 'workwise' });
    expect(db.customer_direct_debits[0].id).not.toBe('old');
    expect(db.gocardless_pay_requests[0].direct_debit_id).toBe(db.customer_direct_debits[0].id);
  });

  it('pay_and_dd refuses a customer who already has a Direct Debit', async () => {
    db.customer_direct_debits = [{ id: 'dd', tenant_id: TENANT, customer_id: CUSTOMER, status: 'active' }];
    expect(await customerStart('pay_and_dd')).toEqual({ ok: false, reason: 'already_set_up' });
    expect(post).not.toHaveBeenCalled();
  });

  it('invoice: the amount is the invoice outstanding, the row carries the invoice, and the return goes to the invoice page', async () => {
    const out = await startPayByBank(fakeAdmin(), { from: 'invoice', invoiceToken: TOKEN });
    expect(out.ok).toBe(true);
    expect(post.mock.calls[0][1].billing_requests.payment_request.amount).toBe(4250);
    expect(post.mock.calls[0][1].billing_requests.mandate_request).toBeUndefined();
    expect(db.gocardless_pay_requests[0]).toMatchObject({ invoice_id: INVOICE, amount: 42.5 });
    expect(post.mock.calls[1][1].billing_request_flows.redirect_uri).toBe(`https://app.joinworkwise.com/pay/i/${TOKEN}?bank=done`);
  });

  it.each([
    ['no such page', () => (customerPage.value = null), 'not_available'],
    ['Direct Debit not On', () => (ddState.value = 'verifying'), 'not_available'],
    ['not connected', () => (connected.value = false), 'not_available'],
    ['nothing owed', () => (numbers.owed = 0), 'nothing_owed'],
    ['under £1', () => (numbers.owed = 0.5), 'nothing_owed'],
    ['all already on its way', () => Object.assign(numbers, { owed: 15, collecting: 15 }), 'nothing_owed'],
    ['over £5,000', () => (numbers.owed = 5000.01), 'too_large'],
  ])('refuses: %s', async (_name, arrange, reason) => {
    arrange();
    expect(await customerStart()).toEqual({ ok: false, reason });
    expect(post).not.toHaveBeenCalled();
    expect(db.gocardless_pay_requests).toHaveLength(0);
  });

  it('invoice: a void invoice or nothing outstanding is refused', async () => {
    (invoicePage.value!.invoice as Row).status = 'void';
    expect(await startPayByBank(fakeAdmin(), { from: 'invoice', invoiceToken: TOKEN })).toEqual({ ok: false, reason: 'not_available' });
    (invoicePage.value!.invoice as Row).status = 'issued';
    (invoicePage.value!.invoice as Row).balanceDue = 0;
    expect(await startPayByBank(fakeAdmin(), { from: 'invoice', invoiceToken: TOKEN })).toEqual({ ok: false, reason: 'nothing_owed' });
  });

  it('GoCardless refusing the billing request → provider_error, nothing stored', async () => {
    post.mockRejectedValueOnce(new GoCardlessError({ message: 'no', status: 422, type: 'validation_failed', reasons: ['x'] }));
    expect(await customerStart()).toEqual({ ok: false, reason: 'provider_error' });
    expect(db.gocardless_pay_requests).toHaveLength(0);
  });

  it('GoCardless refusing the flow marks the row failed', async () => {
    post.mockResolvedValueOnce({ billing_requests: { id: 'BRQX' } });
    post.mockRejectedValueOnce(new GoCardlessError({ message: 'no', status: 500 }));
    expect(await customerStart()).toEqual({ ok: false, reason: 'provider_error' });
    expect(db.gocardless_pay_requests[0]).toMatchObject({ status: 'failed' });
    expect(String(db.gocardless_pay_requests[0].failure_message)).toContain('GoCardless');
  });

  it('the same billing request twice in a minute reuses its row', async () => {
    post.mockImplementation(async (path: string) =>
      path === '/billing_requests'
        ? { billing_requests: { id: 'SAME' } }
        : { billing_request_flows: { authorisation_url: 'https://pay.gocardless.com/flow/1' } },
    );
    await customerStart();
    const out = await customerStart();
    expect(out.ok).toBe(true);
    expect(db.gocardless_pay_requests).toHaveLength(1);
  });

  it('a failure saving the row (not a duplicate) gives provider_error and no page', async () => {
    failInsert.table = 'gocardless_pay_requests';
    expect(await customerStart()).toEqual({ ok: false, reason: 'provider_error' });
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe('onPayRequestFulfilled', () => {
  const br = { id: 'BRQ1', links: { payment_request_payment: 'PM1' } };
  beforeEach(() => {
    db.gocardless_pay_requests = [
      { id: 'pr-1', tenant_id: TENANT, customer_id: CUSTOMER, invoice_id: null, status: 'started', gocardless_billing_request_id: 'BRQ1', gocardless_payment_id: null, payment_id: null },
    ];
  });

  it('marks the request fulfilled with the payment id; a payment not yet confirmed records nothing', async () => {
    get.mockResolvedValue({ payments: { id: 'PM1', status: 'pending_submission', amount: 1500 } });
    await onPayRequestFulfilled(fakeAdmin(), TENANT, br);
    expect(db.gocardless_pay_requests[0]).toMatchObject({ status: 'fulfilled', gocardless_payment_id: 'PM1' });
    expect(db.gocardless_pay_requests[0].fulfilled_at).toBeTruthy();
    expect(db.payments).toHaveLength(0);
  });

  it('already confirmed → one payment recorded straight away, replay adds none', async () => {
    get.mockResolvedValue({ payments: { id: 'PM1', status: 'confirmed', amount: 1500 } });
    const admin = fakeAdmin();
    await onPayRequestFulfilled(admin, TENANT, br);
    await onPayRequestFulfilled(admin, TENANT, br);
    expect(db.payments).toHaveLength(1);
    expect(db.payments[0]).toMatchObject({ method: 'pay_by_bank', source: 'gocardless', amount: 15, recorded_by_user_id: null });
    expect(db.gocardless_pay_requests[0]).toMatchObject({ status: 'paid', payment_id: db.payments[0].id });
    expect(notice).toHaveBeenCalledTimes(1);
    expect(pushes).toHaveLength(1);
  });

  it('an unknown billing request, or another business, does nothing', async () => {
    await onPayRequestFulfilled(fakeAdmin(), TENANT, { id: 'NOPE', links: {} });
    await onPayRequestFulfilled(fakeAdmin(), 'other-tenant', br);
    expect(db.gocardless_pay_requests[0].status).toBe('started');
    expect(get).not.toHaveBeenCalled();
  });
});

describe('onPayRequestPayment', () => {
  const pay = (status: string) => ({ id: 'PM1', status, amount: 1500 });
  beforeEach(() => {
    db.gocardless_pay_requests = [
      { id: 'pr-1', tenant_id: TENANT, customer_id: CUSTOMER, invoice_id: INVOICE, status: 'fulfilled', gocardless_payment_id: 'PM1', payment_id: null },
    ];
  });

  it('confirmed: one payment carrying the invoice, thank-you and push once, even on replay', async () => {
    const admin = fakeAdmin();
    await onPayRequestPayment(admin, TENANT, pay('confirmed'), '2026-10-01T09:00:00.000Z');
    await onPayRequestPayment(admin, TENANT, pay('paid_out'), '2026-10-01T09:05:00.000Z');
    expect(db.payments).toHaveLength(1);
    expect(db.payments[0]).toMatchObject({
      tenant_id: TENANT,
      customer_id: CUSTOMER,
      amount: 15,
      method: 'pay_by_bank',
      source: 'gocardless',
      status: 'active',
      received_at: '2026-10-01T09:00:00.000Z',
      gocardless_payment_id: 'PM1',
      invoice_id: INVOICE,
    });
    expect(db.gocardless_pay_requests[0]).toMatchObject({ status: 'paid', payment_id: db.payments[0].id });
    expect(notice).toHaveBeenCalledTimes(1);
    expect(notice).toHaveBeenCalledWith(expect.anything(), { tenantId: TENANT, paymentId: db.payments[0].id });
    expect(pushes).toEqual([{ kind: 'card_payment', title: 'Payment received', body: '£15 from Jane Wright by bank', data: expect.anything() }]);
  });

  it('a payment already recorded (crash between steps) finishes the request without a second row', async () => {
    db.payments = [{ id: 'pay-x', tenant_id: TENANT, gocardless_payment_id: 'PM1' }];
    await onPayRequestPayment(fakeAdmin(), TENANT, pay('confirmed'), '2026-10-01T09:00:00.000Z');
    expect(db.payments).toHaveLength(1);
    expect(db.gocardless_pay_requests[0]).toMatchObject({ status: 'paid', payment_id: 'pay-x' });
  });

  it('a database error recording the payment throws (the event is retried) and nothing is marked paid', async () => {
    failInsert.table = 'payments';
    await expect(onPayRequestPayment(fakeAdmin(), TENANT, pay('confirmed'), '2026-10-01T09:00:00.000Z')).rejects.toThrow();
    expect(db.gocardless_pay_requests[0].status).toBe('fulfilled');
    expect(notice).not.toHaveBeenCalled();
  });

  it('a thank-you that fails does not undo the payment', async () => {
    notice.mockRejectedValue(new Error('email down'));
    await onPayRequestPayment(fakeAdmin(), TENANT, pay('confirmed'), '2026-10-01T09:00:00.000Z');
    expect(db.payments).toHaveLength(1);
    expect(db.gocardless_pay_requests[0].status).toBe('paid');
  });

  it.each([
    ['failed', 'failed'],
    ['cancelled', 'cancelled'],
    ['customer_approval_denied', 'cancelled'],
  ])('%s before any payment: request → %s, nothing recorded, no message', async (status, expected) => {
    await onPayRequestPayment(fakeAdmin(), TENANT, pay(status), '2026-10-01T09:00:00.000Z');
    expect(db.gocardless_pay_requests[0]).toMatchObject({ status: expected });
    expect(db.gocardless_pay_requests[0].finished_at).toBeTruthy();
    expect(db.payments).toHaveLength(0);
    expect(notice).not.toHaveBeenCalled();
    expect(pushes).toHaveLength(0);
  });

  it('failed after confirmation voids the payment', async () => {
    const admin = fakeAdmin();
    await onPayRequestPayment(admin, TENANT, pay('confirmed'), '2026-10-01T09:00:00.000Z');
    await onPayRequestPayment(admin, TENANT, pay('failed'), '2026-10-02T09:00:00.000Z');
    expect(db.payments[0]).toMatchObject({ status: 'void', void_reason: 'Pay by Bank failed after confirmation' });
    expect(db.gocardless_pay_requests[0].status).toBe('failed');
  });

  it('other statuses and unknown payments do nothing', async () => {
    await onPayRequestPayment(fakeAdmin(), TENANT, pay('pending_submission'), '2026-10-01T09:00:00.000Z');
    await onPayRequestPayment(fakeAdmin(), TENANT, { id: 'PMX', status: 'confirmed', amount: 100 }, '2026-10-01T09:00:00.000Z');
    expect(db.payments).toHaveLength(0);
    expect(db.gocardless_pay_requests[0].status).toBe('fulfilled');
  });
});
