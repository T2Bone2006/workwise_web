import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '11111111-1111-4111-8111-111111111111';
const NONCE = 'nonce-restart-1';
const OWNER_ONLY = 'Only the account owner can change the plan.';
const MANAGED = 'Your plan is managed by WorkWise. Contact us to make changes.';

const state = vi.hoisted(() => ({
  tenantId: '11111111-1111-4111-8111-111111111111' as string | null,
  userId: 'user-1' as string | null,
  role: 'admin' as string | null,
  customerId: 'cus_1' as string | null,
  subs: [{ source: 'stripe', product: 'rounds', status: 'canceled' }] as {
    source: string;
    product: string;
    status: string;
  }[],
  readError: false,
}));

const { stripe, getStripe } = vi.hoisted(() => {
  const stripe = {
    checkout: { sessions: { create: vi.fn() } },
  };
  return { stripe, getStripe: vi.fn(() => stripe) };
});

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock('@/lib/stripe/client', () => ({
  getStripe,
  getAppUrl: () => 'http://localhost:3000',
}));
vi.mock('@/lib/data/tenant', () => ({
  getTenantIdForCurrentUser: async () => state.tenantId,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.userId ? { id: state.userId } : null }, error: null }),
    },
    from(table: string) {
      const api = {
        select() {
          return api;
        },
        eq() {
          return api;
        },
        maybeSingle: async () => {
          if (state.readError) return { data: null, error: { message: 'down' } };
          if (table === 'tenants') return { data: { stripe_customer_id: state.customerId }, error: null };
          if (table === 'users') return { data: state.userId ? { role: state.role, tenant_id: TENANT } : null, error: null };
          return { data: null, error: null };
        },
        then(onFulfilled: (value: { data: unknown; error: unknown }) => unknown, onRejected?: (err: unknown) => unknown) {
          const result = state.readError
            ? { data: null, error: { message: 'down' } }
            : { data: table === 'subscriptions' ? state.subs : [], error: null };
          return Promise.resolve(result).then(onFulfilled, onRejected);
        },
      };
      return api;
    },
  }),
}));

import { createRestartCheckout } from '@/lib/billing/restart';
import { startRestartAction } from '@/lib/actions/billing';

const ENV: Record<string, string> = {
  STRIPE_PRICE_ROUNDS: 'price_rounds_m',
  STRIPE_PRICE_ROUNDS_YEARLY: 'price_rounds_y',
  STRIPE_PRICE_LITE: 'price_lite_m',
  STRIPE_PRICE_LITE_YEARLY: 'price_lite_y',
  STRIPE_PRICE_BOTH: 'price_both_m',
  STRIPE_PRICE_BOTH_YEARLY: 'price_both_y',
};

describe('createRestartCheckout', () => {
  beforeEach(() => {
    state.tenantId = TENANT;
    state.userId = 'user-1';
    state.role = 'admin';
    state.customerId = 'cus_1';
    state.subs = [{ source: 'stripe', product: 'rounds', status: 'canceled' }];
    state.readError = false;
    stripe.checkout.sessions.create.mockReset();
    stripe.checkout.sessions.create.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.test/c' });
    for (const [key, value] of Object.entries(ENV)) process.env[key] = value;
  });

  it('opens Checkout with no discounts and metadata.kind = restart', async () => {
    const url = await createRestartCheckout(TENANT, { plan: 'rounds', interval: 'month' }, NONCE);
    expect(url).toBe('https://checkout.stripe.test/c');
    expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    const [body, options] = stripe.checkout.sessions.create.mock.calls[0] as [
      Record<string, unknown>,
      { idempotencyKey?: string },
    ];
    expect(body).not.toHaveProperty('discounts');
    expect(body).toMatchObject({
      mode: 'subscription',
      customer: 'cus_1',
      line_items: [{ price: 'price_rounds_m', quantity: 1 }],
      allow_promotion_codes: true,
      metadata: { kind: 'restart', tenant_id: TENANT },
      subscription_data: {
        metadata: { kind: 'restart', tenant_id: TENANT, plan: 'rounds', interval: 'month' },
      },
      success_url: 'http://localhost:3000/dashboard?restarted=1',
      cancel_url: 'http://localhost:3000/dashboard',
    });
    expect(options).toEqual({ idempotencyKey: `restart-${TENANT}-${NONCE}` });
  });

  it('uses the same idempotency key when the nonce is the same', async () => {
    await createRestartCheckout(TENANT, { plan: 'lite', interval: 'year' }, NONCE);
    await createRestartCheckout(TENANT, { plan: 'lite', interval: 'year' }, NONCE);
    const keys = stripe.checkout.sessions.create.mock.calls.map((call) => (call[1] as { idempotencyKey: string }).idempotencyKey);
    expect(keys).toEqual([`restart-${TENANT}-${NONCE}`, `restart-${TENANT}-${NONCE}`]);
    const body = stripe.checkout.sessions.create.mock.calls[0]?.[0] as { line_items: { price: string }[] };
    expect(body.line_items[0]?.price).toBe('price_lite_y');
  });

  it('refuses while a payment is only overdue', async () => {
    state.subs = [{ source: 'stripe', product: 'rounds', status: 'past_due' }];
    await expect(createRestartCheckout(TENANT, { plan: 'rounds', interval: 'month' }, NONCE)).rejects.toThrow('not_ended');
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('refuses a managed or Pro business', async () => {
    state.customerId = null;
    await expect(createRestartCheckout(TENANT, { plan: 'rounds', interval: 'month' }, NONCE)).rejects.toThrow('managed');

    state.customerId = 'cus_1';
    state.subs = [{ source: 'manual', product: 'rounds', status: 'canceled' }];
    await expect(createRestartCheckout(TENANT, { plan: 'rounds', interval: 'month' }, NONCE)).rejects.toThrow('managed');

    state.subs = [{ source: 'stripe', product: 'pro', status: 'canceled' }];
    await expect(createRestartCheckout(TENANT, { plan: 'rounds', interval: 'month' }, NONCE)).rejects.toThrow('managed');
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
});

describe('startRestartAction', () => {
  beforeEach(() => {
    state.tenantId = TENANT;
    state.userId = 'user-1';
    state.role = 'admin';
    state.customerId = 'cus_1';
    state.subs = [{ source: 'stripe', product: 'rounds', status: 'canceled' }];
    state.readError = false;
    stripe.checkout.sessions.create.mockReset();
    stripe.checkout.sessions.create.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.test/c' });
    for (const [key, value] of Object.entries(ENV)) process.env[key] = value;
  });

  it('redirects the account owner to Checkout', async () => {
    await expect(startRestartAction({ plan: 'rounds', interval: 'month' }, NONCE)).rejects.toThrow(
      'REDIRECT https://checkout.stripe.test/c',
    );
    const body = stripe.checkout.sessions.create.mock.calls[0]?.[0] as { discounts?: unknown; metadata: { kind: string } };
    expect(body.discounts).toBeUndefined();
    expect(body.metadata.kind).toBe('restart');
  });

  it('refuses anyone who is not the account owner', async () => {
    state.role = 'worker';
    await expect(startRestartAction({ plan: 'rounds', interval: 'month' }, NONCE)).resolves.toEqual({
      ok: false,
      error: OWNER_ONLY,
    });
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('tells a managed business to contact WorkWise', async () => {
    state.customerId = null;
    await expect(startRestartAction({ plan: 'rounds', interval: 'month' }, NONCE)).resolves.toEqual({
      ok: false,
      error: MANAGED,
    });
  });
});
