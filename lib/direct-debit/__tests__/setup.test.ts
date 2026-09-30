import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const state = { value: 'on' as 'on' | 'off' | 'verifying' | 'needs_details' };
const post = vi.fn();
const connected = { value: true };
const sendCustomerMessage = vi.fn();

vi.mock('@/lib/direct-debit/state', () => ({
  getDirectDebitState: async () => state.value,
}));
vi.mock('@/lib/gocardless/connection', () => ({
  clientForTenant: async () =>
    connected.value
      ? { client: { post }, connection: { organisation_id: 'OR1', status: 'connected' } }
      : null,
}));
vi.mock('@/lib/messaging/send', () => ({
  sendCustomerMessage: (input: unknown) => sendCustomerMessage(input),
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

import { GoCardlessError } from '@/lib/gocardless/client';
import {
  directDebitInviteUrl,
  payerNameParts,
  sendDirectDebitInvite,
  startDirectDebitSetup,
} from '@/lib/direct-debit/setup';

const TENANT = '11111111-1111-1111-1111-111111111111';
const CUSTOMER = '33333333-3333-3333-3333-333333333333';
const TOKEN = 'tok_abcdefghijklmnopqrstuvwxyz';

type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;

function fakeAdmin(db: Db): SupabaseClient {
  const from = (table: string) => {
    db[table] ??= [];
    const rows = db[table];
    let op: 'select' | 'insert' | 'delete' = 'select';
    let payload: Row = {};
    const filters: [string, unknown][] = [];
    const finish = async (single: boolean) => {
      if (op === 'insert') {
        rows.push({ id: `row-${rows.length + 1}`, created_at: new Date().toISOString(), ...payload });
        return { data: null, error: null };
      }
      const hit = rows.filter((r) => filters.every(([c, v]) => r[c] === v));
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
      delete() {
        op = 'delete';
        return builder;
      },
      eq(c: string, v: unknown) {
        filters.push([c, v]);
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      maybeSingle() {
        return finish(true);
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return finish(false).then(resolve, reject);
      },
    };
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

function baseDb(): Db {
  return {
    customers: [
      {
        id: CUSTOMER,
        tenant_id: TENANT,
        name: 'Mrs Jane Wright',
        email: 'jane@example.com',
        phone_e164: '+447700900456',
        type: 'individual',
        company_name: null,
        billing_address: '9 Old Road, LS9 9ZZ',
      },
    ],
    customer_direct_debits: [],
    service_agreements: [
      {
        tenant_id: TENANT,
        customer_id: CUSTOMER,
        status: 'active',
        address: '1 High Street, Leeds',
        postcode: 'LS1 4AB',
      },
    ],
    customer_balances: [{ tenant_id: TENANT, customer_id: CUSTOMER, owed_amount: 15 }],
  };
}

function goCardlessAnswers() {
  post.mockImplementation(async (path: string) => {
    if (path === '/billing_requests') return { billing_requests: { id: 'BRQ1' } };
    if (path === '/billing_request_flows') {
      return { billing_request_flows: { authorisation_url: 'https://pay-sandbox.gocardless.com/flow/BRF1' } };
    }
    throw new Error(`unexpected ${path}`);
  });
}

beforeEach(() => {
  state.value = 'on';
  connected.value = true;
  post.mockReset();
  sendCustomerMessage.mockReset();
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('payerNameParts', () => {
  const cases: [Parameters<typeof payerNameParts>[0], ReturnType<typeof payerNameParts>][] = [
    [{ name: 'Mrs Jane Wright', companyName: null, type: 'individual' }, { given: 'Jane', family: 'Wright' }],
    [{ name: 'Jane Anne Wright', companyName: null, type: 'individual' }, { given: 'Jane', family: 'Anne Wright' }],
    [{ name: 'Dr. Smith', companyName: null, type: null }, { given: 'Smith', family: 'Smith' }],
    [{ name: 'Cher', companyName: null, type: 'individual' }, { given: 'Cher', family: 'Cher' }],
    [{ name: 'Jane Wright', companyName: 'Wright Lettings Ltd', type: 'individual' }, { company: 'Wright Lettings Ltd' }],
    [{ name: 'Acme Property', companyName: null, type: 'bulk_client' }, { company: 'Acme Property' }],
  ];
  for (const [input, expected] of cases) {
    it(`${input.name} → ${JSON.stringify(expected)}`, () => {
      expect(payerNameParts(input)).toEqual(expected);
    });
  }
});

describe('startDirectDebitSetup', () => {
  const run = (db: Db) =>
    startDirectDebitSetup(fakeAdmin(db), { tenantId: TENANT, customerId: CUSTOMER, payToken: TOKEN });

  it('not on → not_available, nothing sent to GoCardless', async () => {
    state.value = 'verifying';
    expect(await run(baseDb())).toEqual({ ok: false, reason: 'not_available' });
    state.value = 'on';
    connected.value = false;
    expect(await run(baseDb())).toEqual({ ok: false, reason: 'not_available' });
    expect(post).not.toHaveBeenCalled();
  });

  it('unknown customer → customer_not_found', async () => {
    const db = baseDb();
    db.customers[0].tenant_id = 'someone-else';
    expect(await run(db)).toEqual({ ok: false, reason: 'customer_not_found' });
  });

  it('already has a pending or active Direct Debit → already_set_up', async () => {
    const db = baseDb();
    db.customer_direct_debits.push({ tenant_id: TENANT, customer_id: CUSTOMER, status: 'pending' });
    expect(await run(db)).toEqual({ ok: false, reason: 'already_set_up' });
    expect(post).not.toHaveBeenCalled();
  });

  it('creates the billing request and flow, and records setting_up', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T12:34:56Z'));
    goCardlessAnswers();
    const db = baseDb();
    const result = await run(db);
    expect(result).toEqual({ ok: true, url: 'https://pay-sandbox.gocardless.com/flow/BRF1' });

    const [brPath, brBody, brOpts] = post.mock.calls[0];
    expect(brPath).toBe('/billing_requests');
    expect(brBody).toEqual({
      billing_requests: {
        mandate_request: { scheme: 'bacs', currency: 'GBP' },
        metadata: {
          workwise_tenant_id: TENANT,
          workwise_customer_id: CUSTOMER,
          workwise_kind: 'dd_setup',
        },
      },
    });
    expect(brOpts).toEqual({
      idempotencyKey: `ddsetup_${CUSTOMER}_${Math.floor(Date.parse('2026-09-30T12:34:56Z') / 60_000)}`,
    });

    const [flowPath, flowBody, flowOpts] = post.mock.calls[1];
    expect(flowPath).toBe('/billing_request_flows');
    expect(flowOpts).toEqual({ idempotencyKey: 'ddflow_BRQ1' });
    expect(flowBody).toEqual({
      billing_request_flows: {
        redirect_uri: `https://app.example.test/pay/${TOKEN}?dd=done`,
        exit_uri: `https://app.example.test/pay/${TOKEN}?dd=cancelled`,
        lock_currency: true,
        show_success_redirect_button: true,
        prefilled_customer: {
          given_name: 'Jane',
          family_name: 'Wright',
          email: 'jane@example.com',
          address_line1: '1 High Street',
          postal_code: 'LS1 4AB',
          country_code: 'GB',
        },
        links: { billing_request: 'BRQ1' },
      },
    });
    // No subscriptions or payment requests on the billing request (D2).
    expect(JSON.stringify(brBody)).not.toContain('payment_request');

    expect(db.customer_direct_debits).toEqual([
      expect.objectContaining({
        tenant_id: TENANT,
        customer_id: CUSTOMER,
        gocardless_organisation_id: 'OR1',
        gocardless_billing_request_id: 'BRQ1',
        source: 'workwise',
        status: 'setting_up',
      }),
    ]);
  });

  it('removes abandoned pages and reuses the GoCardless customer', async () => {
    goCardlessAnswers();
    const db = baseDb();
    db.customer_direct_debits.push(
      { id: 'old-1', tenant_id: TENANT, customer_id: CUSTOMER, status: 'setting_up', gocardless_billing_request_id: 'BRQ_OLD' },
      { id: 'old-2', tenant_id: TENANT, customer_id: CUSTOMER, status: 'cancelled', gocardless_customer_id: 'CU_PREV' },
    );
    await run(db);
    expect(post.mock.calls[0][1].billing_requests.links).toEqual({ customer: 'CU_PREV' });
    expect(db.customer_direct_debits.map((r) => r.gocardless_billing_request_id ?? r.id)).toEqual([
      'old-2',
      'BRQ1',
    ]);
  });

  it('a business customer is prefilled as a company, address from the customer when no agreement', async () => {
    goCardlessAnswers();
    const db = baseDb();
    db.customers[0].company_name = 'Wright Lettings Ltd';
    db.service_agreements = [];
    await run(db);
    const prefill = post.mock.calls[1][1].billing_request_flows.prefilled_customer;
    expect(prefill).toEqual({
      company_name: 'Wright Lettings Ltd',
      email: 'jane@example.com',
      address_line1: '9 Old Road',
      postal_code: 'LS9 9ZZ',
      country_code: 'GB',
    });
  });

  it('a GoCardless error → provider_error, nothing recorded', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    post.mockRejectedValue(
      new GoCardlessError({ message: 'Validation failed', status: 422, type: 'validation_failed', reasons: ['x'] }),
    );
    const db = baseDb();
    expect(await run(db)).toEqual({ ok: false, reason: 'provider_error' });
    expect(db.customer_direct_debits).toHaveLength(0);
    errorLog.mockRestore();
  });
});

describe('directDebitInviteUrl', () => {
  it('is the pay page with ?dd=1', async () => {
    expect(await directDebitInviteUrl(fakeAdmin(baseDb()), { tenantId: TENANT, customerId: CUSTOMER })).toBe(
      `https://app.example.test/pay/${TOKEN}?dd=1`,
    );
  });
});

describe('sendDirectDebitInvite', () => {
  const run = (db: Db) => sendDirectDebitInvite(fakeAdmin(db), { tenantId: TENANT, customerId: CUSTOMER });

  it('goes through the message door as dd_invite with a daily dedupe key', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T12:00:00Z'));
    sendCustomerMessage.mockResolvedValue({ outcome: 'email_sent', messageId: 'm1' });
    expect(await run(baseDb())).toEqual({ ok: true, channel: 'email' });
    const input = sendCustomerMessage.mock.calls[0][0];
    expect(input).toMatchObject({
      tenantId: TENANT,
      customerId: CUSTOMER,
      kind: 'dd_invite',
      dedupeKey: `dd_invite:${CUSTOMER}:2026-09-30`,
    });
    expect(input.channelOrderOverride).toBeUndefined();
    expect(input.text({ firstText: false })).toContain(`/pay/${TOKEN}?dd=1`);
    expect(typeof input.email).toBe('function');
  });

  it('a text counts as sms; a second send the same day is a duplicate', async () => {
    sendCustomerMessage.mockResolvedValueOnce({ outcome: 'text_sent', messageId: 'm1' });
    expect(await run(baseDb())).toEqual({ ok: true, channel: 'sms' });
    sendCustomerMessage.mockResolvedValueOnce({ outcome: 'duplicate' });
    expect(await run(baseDb())).toEqual({ ok: false, error: 'The invitation was already sent today.' });
  });

  it('No messages is respected (the door decides)', async () => {
    sendCustomerMessage.mockResolvedValueOnce({ outcome: 'skipped', reason: 'no_messages' });
    expect(await run(baseDb())).toEqual({
      ok: false,
      error: 'This customer is set to No messages — copy the link instead.',
    });
  });

  it('no email and no mobile → copy the link instead', async () => {
    const db = baseDb();
    db.customers[0].email = null;
    db.customers[0].phone_e164 = null;
    expect(await run(db)).toEqual({
      ok: false,
      error: 'No email or mobile for this customer — copy the link instead.',
    });
    expect(sendCustomerMessage).not.toHaveBeenCalled();
  });

  it('Direct Debit not on → nothing sent', async () => {
    state.value = 'off';
    expect((await run(baseDb())).ok).toBe(false);
    expect(sendCustomerMessage).not.toHaveBeenCalled();
  });
});
