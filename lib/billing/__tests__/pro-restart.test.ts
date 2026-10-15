import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '11111111-1111-4111-8111-111111111111';
const NONCE = 'nonce-pro-restart-1';

type Row = { source: string; product: string; status: string; billing_interval?: string };
const state = vi.hoisted(() => ({
  customerId: 'cus_1' as string | null,
  rows: [] as Row[],
  readError: false,
  team: 4 as number | null,
  sessionUrl: 'https://checkout.stripe.test/s_1' as string | null,
}));
const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({ checkout: { sessions: { create } } }),
  getAppUrl: () => 'http://localhost:3000',
}));
vi.mock('@/lib/data/workers', () => ({ countTeamWorkers: async () => state.team }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from(table: string) {
      const api = {
        select: () => api,
        eq: () => api,
        order: () => api,
        maybeSingle: async () =>
          state.readError
            ? { data: null, error: { message: 'down' } }
            : { data: table === 'tenants' ? { stripe_customer_id: state.customerId } : null, error: null },
        then(ok: (v: { data: unknown; error: unknown }) => unknown, bad?: (e: unknown) => unknown) {
          const result = state.readError
            ? { data: null, error: { message: 'down' } }
            : { data: table === 'subscriptions' ? state.rows : [], error: null };
          return Promise.resolve(result).then(ok, bad);
        },
      };
      return api;
    },
  }),
}));

import { createProRestartCheckout, proRestartChoice } from '@/lib/billing/pro-restart';

const ENV: Record<string, string> = {
  STRIPE_PRICE_STARTER: 'price_starter_m',
  STRIPE_PRICE_STARTER_YEARLY: 'price_starter_y',
  STRIPE_PRICE_EXTRA_WORKER_STARTER: 'price_extra_starter_m',
  STRIPE_PRICE_EXTRA_WORKER_STARTER_YEARLY: 'price_extra_starter_y',
  STRIPE_PRICE_GROWTH: 'price_growth_m',
  STRIPE_PRICE_EXTRA_WORKER_GROWTH: 'price_extra_growth_m',
};

const ended: Row = { source: 'stripe', product: 'starter', status: 'canceled', billing_interval: 'year' };

describe('proRestartChoice', () => {
  beforeEach(() => {
    state.customerId = 'cus_1';
    state.readError = false;
    state.rows = [ended];
  });

  it('returns the ended Pro tier and interval', async () => {
    expect(await proRestartChoice(TENANT)).toEqual({ tier: 'starter', interval: 'year' });
  });

  it('is null for manual accounts, live plans, Rounds-only history and read errors', async () => {
    state.rows = [{ source: 'manual', product: 'pro', status: 'manual' }];
    expect(await proRestartChoice(TENANT)).toBeNull();
    state.rows = [{ source: 'stripe', product: 'starter', status: 'active' }];
    expect(await proRestartChoice(TENANT)).toBeNull();
    state.rows = [{ source: 'stripe', product: 'rounds', status: 'canceled' }];
    expect(await proRestartChoice(TENANT)).toBeNull();
    state.rows = [ended];
    state.readError = true;
    expect(await proRestartChoice(TENANT)).toBeNull();
  });
});

describe('createProRestartCheckout', () => {
  beforeEach(() => {
    for (const [k, v] of Object.entries(ENV)) process.env[k] = v;
    state.customerId = 'cus_1';
    state.rows = [ended];
    state.readError = false;
    state.team = 4;
    state.sessionUrl = 'https://checkout.stripe.test/s_1';
    create.mockReset();
    create.mockImplementation(async () => ({ url: state.sessionUrl }));
  });

  const body = () => create.mock.calls[0][0] as Record<string, unknown>;
  const choice = { tier: 'starter', interval: 'year' } as const;

  it('restarts with the plan only when the team fits', async () => {
    expect(await createProRestartCheckout(TENANT, choice, NONCE)).toBe('https://checkout.stripe.test/s_1');
    expect(body().line_items).toEqual([{ price: 'price_starter_y', quantity: 1 }]);
  });

  it('adds the extras line for the team over the allowance', async () => {
    state.team = 13;
    await createProRestartCheckout(TENANT, choice, NONCE);
    expect(body().line_items).toEqual([
      { price: 'price_starter_y', quantity: 1 },
      { price: 'price_extra_starter_y', quantity: 3 },
    ]);
  });

  it('has no discount, no promo box, the restart metadata and an idempotency key', async () => {
    await createProRestartCheckout(TENANT, choice, NONCE);
    const b = body();
    expect('discounts' in b).toBe(false);
    expect(b.allow_promotion_codes).toBe(false);
    expect(b.customer).toBe('cus_1');
    expect(b.metadata).toEqual({ kind: 'restart', tenant_id: TENANT });
    expect(b.subscription_data).toEqual({
      metadata: { kind: 'restart', tenant_id: TENANT, tier: 'starter', interval: 'year' },
    });
    expect(create.mock.calls[0][1]).toEqual({ idempotencyKey: `pro-restart-${TENANT}-${NONCE}` });
  });

  it('refuses manual accounts, no customer, and a live subscription as managed', async () => {
    state.rows = [{ source: 'manual', product: 'pro', status: 'manual' }];
    await expect(createProRestartCheckout(TENANT, choice, NONCE)).rejects.toThrow('managed');
    state.rows = [ended, { source: 'stripe', product: 'growth', status: 'active' }];
    await expect(createProRestartCheckout(TENANT, choice, NONCE)).rejects.toThrow('managed');
    state.rows = [ended];
    state.customerId = null;
    await expect(createProRestartCheckout(TENANT, choice, NONCE)).rejects.toThrow('managed');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a bad choice or nonce before reading anything', async () => {
    await expect(createProRestartCheckout(TENANT, { tier: 'rounds', interval: 'year' } as never, NONCE)).rejects.toThrow('bad_choice');
    await expect(createProRestartCheckout(TENANT, { tier: 'starter', interval: 'week' } as never, NONCE)).rejects.toThrow('bad_choice');
    await expect(createProRestartCheckout(TENANT, choice, 'x')).rejects.toThrow('bad_nonce');
  });

  it('never creates a plan-only Checkout when a needed price id is missing', async () => {
    state.team = 13;
    delete process.env.STRIPE_PRICE_EXTRA_WORKER_STARTER_YEARLY;
    await expect(createProRestartCheckout(TENANT, choice, NONCE)).rejects.toThrow('missing_price');
    delete process.env.STRIPE_PRICE_STARTER_YEARLY;
    state.team = 2;
    await expect(createProRestartCheckout(TENANT, choice, NONCE)).rejects.toThrow('missing_price');
    expect(create).not.toHaveBeenCalled();
  });

  it('fails safe when the account or team count cannot be read, or Stripe gives no URL', async () => {
    state.readError = true;
    await expect(createProRestartCheckout(TENANT, choice, NONCE)).rejects.toThrow('read_failed');
    state.readError = false;
    state.team = null;
    await expect(createProRestartCheckout(TENANT, choice, NONCE)).rejects.toThrow('read_failed');
    state.team = 4;
    state.sessionUrl = null;
    await expect(createProRestartCheckout(TENANT, choice, NONCE)).rejects.toThrow('no_url');
  });
});
