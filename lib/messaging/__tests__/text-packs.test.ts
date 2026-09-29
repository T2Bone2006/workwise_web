import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import type { TextPackKey } from '@/lib/messaging/credits';

const TENANT = '11111111-1111-4111-8111-111111111111';

const customersCreate = vi.fn();
const customersRetrieve = vi.fn();
const sessionsCreate = vi.fn();
const constructEvent = vi.fn();
const provision = vi.fn();

vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    customers: { create: customersCreate, retrieve: customersRetrieve },
    checkout: { sessions: { create: sessionsCreate } },
    webhooks: { constructEvent },
  }),
  getAppUrl: () => 'http://localhost:3000',
}));

vi.mock('@/lib/stripe/provision', () => ({
  provisionFromCheckoutSession: (...args: unknown[]) => provision(...args),
}));

vi.mock('@/lib/stripe/sync-subscription', () => ({
  syncSubscription: vi.fn(),
}));

type TenantRow = { id: string; name: string; stripe_customer_id: string | null };

let tenants: TenantRow[];
let updates: Record<string, unknown>[];
let rpcCalls: Record<string, unknown>[];
let rpcResult: { data: boolean | null; error: { message: string } | null };
let insertError: { code: string; message: string } | null;
let balanceRow: { month: string; month_used: number; pack_balance: number } | null;

function buildAdmin() {
  return {
    from(table: string) {
      if (table === 'tenants') {
        return {
          select() {
            return {
              eq(_col: string, id: string) {
                return {
                  maybeSingle: async () => ({
                    data: tenants.find((row) => row.id === id) ?? null,
                    error: null,
                  }),
                };
              },
            };
          },
          update(payload: Record<string, unknown>) {
            const state = { id: '', onlyIfNull: false };
            const builder = {
              eq(_col: string, id: string) {
                state.id = id;
                return builder;
              },
              is(col: string, val: unknown) {
                if (col === 'stripe_customer_id' && val === null) state.onlyIfNull = true;
                return builder;
              },
              async select() {
                const row = tenants.find((tenant) => tenant.id === state.id);
                const canWrite = Boolean(row) && (!state.onlyIfNull || row?.stripe_customer_id == null);
                if (!canWrite || !row) return { data: [], error: null };
                updates.push(payload);
                if (typeof payload.stripe_customer_id === 'string') {
                  row.stripe_customer_id = payload.stripe_customer_id;
                }
                return { data: [{ stripe_customer_id: row.stripe_customer_id }], error: null };
              },
            };
            return builder;
          },
        };
      }
      if (table === 'stripe_events') {
        return {
          insert: async () => ({ error: insertError }),
          update() {
            return { eq: async () => ({ error: null }) };
          },
          delete() {
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      if (table === 'tenant_text_balance') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({ data: balanceRow, error: null }),
                };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: async (_name: string, args: Record<string, unknown>) => {
      rpcCalls.push(args);
      return rpcResult;
    },
  };
}

let admin: ReturnType<typeof buildAdmin>;
let errorSpy: ReturnType<typeof vi.spyOn>;

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => admin,
}));

import { creditTextPackFromSession, createTextPackCheckout } from '@/lib/messaging/text-packs';
import { getTextUsage } from '@/lib/data/messaging/texts';
import { POST } from '@/app/api/stripe/webhook/route';

const savedEnv = {
  texts250: process.env.STRIPE_PRICE_TEXTS_250,
  texts1000: process.env.STRIPE_PRICE_TEXTS_1000,
  webhook: process.env.STRIPE_WEBHOOK_SECRET,
};

function paidSession(packKey: 'texts_250' | 'texts_1000', id = 'cs_test_1'): Stripe.Checkout.Session {
  return {
    id,
    mode: 'payment',
    payment_status: 'paid',
    customer: 'cus_owner',
    payment_intent: 'pi_1',
    amount_total: packKey === 'texts_250' ? 1000 : 3500,
    metadata: { kind: 'text_pack', tenant_id: TENANT, pack_key: packKey },
  } as unknown as Stripe.Checkout.Session;
}

function webhookRequest(): Request {
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 'sig' },
    body: '{}',
  });
}

beforeEach(() => {
  tenants = [{ id: TENANT, name: 'Acme', stripe_customer_id: 'cus_owner' }];
  updates = [];
  rpcCalls = [];
  rpcResult = { data: true, error: null };
  insertError = null;
  balanceRow = null;
  admin = buildAdmin();
  customersCreate.mockReset();
  customersRetrieve.mockReset();
  sessionsCreate.mockReset();
  constructEvent.mockReset();
  provision.mockReset();
  customersCreate.mockResolvedValue({ id: 'cus_new' });
  customersRetrieve.mockResolvedValue({ id: 'cus_owner', metadata: {} });
  sessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay_test' });
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  process.env.STRIPE_PRICE_TEXTS_250 = 'price_250';
  process.env.STRIPE_PRICE_TEXTS_1000 = 'price_1000';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
});

afterEach(() => {
  errorSpy.mockRestore();
});

afterAll(() => {
  if (savedEnv.texts250 === undefined) delete process.env.STRIPE_PRICE_TEXTS_250;
  else process.env.STRIPE_PRICE_TEXTS_250 = savedEnv.texts250;
  if (savedEnv.texts1000 === undefined) delete process.env.STRIPE_PRICE_TEXTS_1000;
  else process.env.STRIPE_PRICE_TEXTS_1000 = savedEnv.texts1000;
  if (savedEnv.webhook === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
  else process.env.STRIPE_WEBHOOK_SECRET = savedEnv.webhook;
});

describe('text packs', () => {
  it('rejects an unknown pack and a missing price, and creates a Stripe customer when the tenant has none', async () => {
    const unknown = await createTextPackCheckout(admin as unknown as SupabaseClient, {
      tenantId: TENANT,
      userEmail: 'a@b.co',
      packKey: 'nope' as TextPackKey,
      returnTo: 'dashboard',
    });
    expect(unknown).toEqual({ error: 'Unknown pack' });

    delete process.env.STRIPE_PRICE_TEXTS_1000;
    const missing = await createTextPackCheckout(admin as unknown as SupabaseClient, {
      tenantId: TENANT,
      userEmail: 'a@b.co',
      packKey: 'texts_1000',
      returnTo: 'dashboard',
    });
    expect(missing).toEqual({ error: 'Text packs are not set up yet' });

    tenants[0].stripe_customer_id = null;
    const created = await createTextPackCheckout(admin as unknown as SupabaseClient, {
      tenantId: TENANT,
      userEmail: 'a@b.co',
      packKey: 'texts_250',
      returnTo: 'dashboard',
    });
    expect(created).toEqual({ url: 'https://checkout.stripe.com/c/pay_test' });
    expect(customersCreate).toHaveBeenCalledWith({
      email: 'a@b.co',
      name: 'Acme',
      metadata: { workwise_tenant_id: TENANT },
    });
    expect(updates).toEqual([{ stripe_customer_id: 'cus_new' }]);
    expect(sessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        customer: 'cus_new',
        payment_method_types: ['card'],
        line_items: [{ price: 'price_250', quantity: 1 }],
        metadata: { kind: 'text_pack', tenant_id: TENANT, pack_key: 'texts_250' },
        success_url: 'http://localhost:3000/messages/texts-bought?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: 'http://localhost:3000/messages',
      }),
    );

    sessionsCreate.mockClear();
    const phone = await createTextPackCheckout(admin as unknown as SupabaseClient, {
      tenantId: TENANT,
      userEmail: 'a@b.co',
      packKey: 'texts_250',
      returnTo: 'phone',
    });
    expect(phone).toEqual({ url: 'https://checkout.stripe.com/c/pay_test' });
    expect(sessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_new',
        payment_method_types: ['card'],
        success_url: 'http://localhost:3000/connect/texts?status=done',
        cancel_url: 'http://localhost:3000/connect/texts?status=cancelled',
      }),
    );
  });

  it('credits a paid text pack once per session and ignores an unpaid session', async () => {
    expect(await creditTextPackFromSession(paidSession('texts_250'))).toBe(true);
    expect(rpcCalls[0]).toMatchObject({
      p_tenant_id: TENANT,
      p_pack_key: 'texts_250',
      p_texts: 250,
      p_amount_pence: 1000,
      p_checkout_session_id: 'cs_test_1',
      p_payment_intent_id: 'pi_1',
    });

    expect(await creditTextPackFromSession(paidSession('texts_1000', 'cs_test_2'))).toBe(true);
    expect(rpcCalls[1]).toMatchObject({
      p_pack_key: 'texts_1000',
      p_texts: 1000,
      p_checkout_session_id: 'cs_test_2',
    });

    const before = rpcCalls.length;
    const unpaid = paidSession('texts_250', 'cs_unpaid');
    unpaid.payment_status = 'unpaid';
    expect(await creditTextPackFromSession(unpaid)).toBe(false);
    expect(rpcCalls).toHaveLength(before);
  });

  it('does not credit a session whose customer belongs to a different tenant', async () => {
    tenants[0].stripe_customer_id = 'cus_someone_else';
    expect(await creditTextPackFromSession(paidSession('texts_250'))).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });

  it('credits a mismatched customer tagged with the tenant id, and refuses an untagged one', async () => {
    tenants[0].stripe_customer_id = 'cus_saved';
    customersRetrieve.mockResolvedValue({
      id: 'cus_owner',
      metadata: { workwise_tenant_id: TENANT },
    });

    expect(await creditTextPackFromSession(paidSession('texts_250'))).toBe(true);
    expect(customersRetrieve).toHaveBeenCalledWith('cus_owner');
    expect(rpcCalls).toHaveLength(1);
    expect(errorSpy).not.toHaveBeenCalled();

    rpcCalls.length = 0;
    customersRetrieve.mockResolvedValue({ id: 'cus_owner', metadata: {} });
    expect(await creditTextPackFromSession(paidSession('texts_250', 'cs_refused'))).toBe(false);
    expect(rpcCalls).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledWith('[creditTextPackFromSession] refused', {
      tenant_id: TENANT,
      session_id: 'cs_refused',
    });
  });

  it('still provisions a subscription checkout and does not credit a pack', async () => {
    const session = { id: 'cs_sub', mode: 'subscription', metadata: { kind: 'text_pack' } };
    constructEvent.mockReturnValue({
      id: 'evt_sub',
      type: 'checkout.session.completed',
      data: { object: session },
    });

    const response = await POST(webhookRequest());
    expect(response.status).toBe(200);
    expect(provision).toHaveBeenCalledTimes(1);
    expect(provision).toHaveBeenCalledWith(session);
    expect(rpcCalls).toHaveLength(0);
  });

  it('acks a redelivered event before any work, and a repeated session is not credited again', async () => {
    insertError = { code: '23505', message: 'duplicate' };
    constructEvent.mockReturnValue({
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: { object: paidSession('texts_250') },
    });

    const duplicate = await POST(webhookRequest());
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toEqual({ received: true, duplicate: true });
    expect(provision).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(0);

    insertError = null;
    rpcResult = { data: false, error: null };
    constructEvent.mockReturnValue({
      id: 'evt_2',
      type: 'checkout.session.completed',
      data: { object: paidSession('texts_250', 'cs_same') },
    });
    const again = await POST(webhookRequest());
    expect(again.status).toBe(200);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toMatchObject({ p_checkout_session_id: 'cs_same', p_texts: 250 });
    expect(await creditTextPackFromSession(paidSession('texts_250', 'cs_same'))).toBe(false);
  });

  it('reads a missing balance as 100 free and 0 bought', async () => {
    const supabase = {
      from() {
        return {
          select() {
            return {
              eq() {
                return { maybeSingle: async () => ({ data: null, error: null }) };
              },
            };
          },
        };
      },
    };
    const usage = await getTextUsage(
      supabase as unknown as SupabaseClient,
      TENANT,
      new Date('2026-09-28T12:00:00Z'),
    );
    expect(usage.freeUsed).toBe(0);
    expect(usage.freeLeft).toBe(100);
    expect(usage.packLeft).toBe(0);
    expect(usage.month).toBe('2026-09');
    expect(usage.packs.map((pack) => pack.key)).toEqual(['texts_250', 'texts_1000']);
  });
});
