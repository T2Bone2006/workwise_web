import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

const TENANT = '11111111-1111-4111-8111-111111111111';
const CUSTOMER = 'cus_test';

type SubRow = {
  id: string;
  tenant_id: string;
  product: string;
  status: string;
  source: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  plan: string | null;
  billing_interval: string | null;
  canceled_at: string | null;
  cancel_at_period_end: boolean;
  seats: number;
};

type TenantRow = { id: string; stripe_customer_id: string | null };

let subs: SubRow[];
let tenants: TenantRow[];
let clashOn: string | null;

const PRICE_ENV = {
  STRIPE_PRICE_ROUNDS: 'price_rounds_m',
  STRIPE_PRICE_ROUNDS_YEARLY: 'price_rounds_y',
  STRIPE_PRICE_LITE: 'price_lite_m',
  STRIPE_PRICE_LITE_YEARLY: 'price_lite_y',
  STRIPE_PRICE_BOTH: 'price_both_m',
  STRIPE_PRICE_BOTH_YEARLY: 'price_both_y',
} as const;

const savedEnv: Record<string, string | undefined> = {};

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table === 'tenants') return tenantQuery();
      if (table === 'subscriptions') return subscriptionQuery();
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    subscriptions: { retrieve: vi.fn() },
  }),
}));

function matches(row: Record<string, unknown>, filters: Record<string, unknown>) {
  return Object.entries(filters).every(([key, value]) => row[key] === value);
}

function tenantQuery() {
  const filters: Record<string, unknown> = {};
  return {
    select() {
      return this;
    },
    eq(col: string, value: unknown) {
      filters[col] = value;
      return this;
    },
    async maybeSingle() {
      const row = tenants.find((tenant) => matches(tenant, filters)) ?? null;
      return { data: row, error: null };
    },
  };
}

function subscriptionQuery() {
  const filters: Record<string, unknown> = {};
  let pendingUpdate: Record<string, unknown> | null = null;
  const api = {
    select() {
      return api;
    },
    eq(col: string, value: unknown) {
      filters[col] = value;
      if (pendingUpdate) {
        for (const row of subs) {
          if (matches(row, filters)) Object.assign(row, pendingUpdate);
        }
        pendingUpdate = null;
      }
      return api;
    },
    limit() {
      return api;
    },
    update(payload: Record<string, unknown>) {
      pendingUpdate = payload;
      return api;
    },
    async upsert(payload: Omit<SubRow, 'id'> & { id?: string }) {
      if (clashOn && payload.product === clashOn) {
        return {
          error: {
            code: '23505',
            message: 'duplicate key value violates unique constraint "uq_subscriptions_live_product"',
            details: null,
          },
        };
      }
      const existing = subs.find(
        (row) => row.stripe_subscription_id === payload.stripe_subscription_id && row.product === payload.product
      );
      if (existing) Object.assign(existing, payload);
      else subs.push({ ...payload, id: `row-${subs.length + 1}` });
      return { error: null };
    },
    then(resolve: (value: { data: SubRow[]; error: null }) => void) {
      const data = subs.filter((row) => matches(row, filters));
      resolve({ data, error: null });
    },
  };
  return api;
}

function stripeSub(id: string, priceId: string, status = 'active'): Stripe.Subscription {
  return {
    id,
    status,
    customer: CUSTOMER,
    trial_end: null,
    cancel_at_period_end: false,
    canceled_at: null,
    items: { data: [{ price: { id: priceId }, quantity: 1, current_period_end: 1_800_000_000 }] },
  } as unknown as Stripe.Subscription;
}

function seed(product: string, plan: string, subscriptionId = 'sub_1') {
  subs.push({
    id: `seed-${product}`,
    tenant_id: TENANT,
    product,
    status: 'active',
    source: 'stripe',
    stripe_customer_id: CUSTOMER,
    stripe_subscription_id: subscriptionId,
    stripe_price_id: 'price_old',
    plan,
    billing_interval: 'month',
    canceled_at: null,
    cancel_at_period_end: false,
    seats: 1,
  });
}

beforeEach(() => {
  subs = [];
  tenants = [{ id: TENANT, stripe_customer_id: CUSTOMER }];
  clashOn = null;
  for (const [key, value] of Object.entries(PRICE_ENV)) {
    if (!(key in savedEnv)) savedEnv[key] = process.env[key];
    process.env[key] = value;
  }
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    delete savedEnv[key];
  }
});

describe('syncSubscription', () => {
  it('writes a rounds row and a lite row for the bundle', async () => {
    const { syncSubscription } = await import('@/lib/stripe/sync-subscription');
    const result = await syncSubscription(stripeSub('sub_both', 'price_both_m'));
    expect(result).toEqual({ synced: true, tenantId: TENANT, products: ['rounds', 'lite'] });
    expect(subs.map((row) => row.product).sort()).toEqual(['lite', 'rounds']);
    expect(subs.every((row) => row.plan === 'both' && row.billing_interval === 'month' && row.status === 'active')).toBe(
      true
    );
  });

  it('cancels lite when the bundle drops to rounds', async () => {
    seed('rounds', 'both');
    seed('lite', 'both');
    const { syncSubscription } = await import('@/lib/stripe/sync-subscription');
    await syncSubscription(stripeSub('sub_1', 'price_rounds_m'));
    const rounds = subs.find((row) => row.product === 'rounds');
    const lite = subs.find((row) => row.product === 'lite');
    expect(rounds).toMatchObject({ plan: 'rounds', status: 'active' });
    expect(lite?.status).toBe('canceled');
    expect(lite?.canceled_at).toEqual(expect.any(String));
  });

  it('adds lite when rounds becomes the bundle', async () => {
    seed('rounds', 'rounds');
    const { syncSubscription } = await import('@/lib/stripe/sync-subscription');
    await syncSubscription(stripeSub('sub_1', 'price_both_m'));
    expect(subs.find((row) => row.product === 'rounds')).toMatchObject({ plan: 'both', status: 'active' });
    expect(subs.find((row) => row.product === 'lite')).toMatchObject({ plan: 'both', status: 'active' });
  });

  it('ignores an unknown price', async () => {
    const { syncSubscription } = await import('@/lib/stripe/sync-subscription');
    const result = await syncSubscription(stripeSub('sub_old', 'price_49'));
    expect(result).toEqual({ synced: false, reason: 'unknown_price' });
    expect(subs).toHaveLength(0);
  });

  it('does nothing when no business owns the customer yet', async () => {
    tenants = [];
    const { syncSubscription } = await import('@/lib/stripe/sync-subscription');
    const result = await syncSubscription(stripeSub('sub_early', 'price_rounds_m'));
    expect(result).toEqual({ synced: false, reason: 'no_tenant' });
    expect(subs).toHaveLength(0);
  });

  it('throws when a second live lite subscription would be created', async () => {
    clashOn = 'lite';
    const { syncSubscription } = await import('@/lib/stripe/sync-subscription');
    await expect(syncSubscription(stripeSub('sub_clash', 'price_both_m'))).rejects.toThrow(
      /live product clash on sub_clash/
    );
  });
});

describe('syncRestartSession', () => {
  it('syncs the existing business when the customer matches', async () => {
    const { syncRestartSession } = await import('@/lib/stripe/sync-subscription');
    const session = {
      id: 'cs_ok',
      customer: CUSTOMER,
      metadata: { kind: 'restart', tenant_id: TENANT },
      subscription: stripeSub('sub_restart', 'price_lite_m'),
    } as unknown as Stripe.Checkout.Session;
    await syncRestartSession(session);
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ tenant_id: TENANT, product: 'lite', plan: 'lite', status: 'active' });
  });

  it('refuses a tenant that does not own the customer', async () => {
    tenants = [{ id: TENANT, stripe_customer_id: 'cus_other' }];
    const { syncRestartSession } = await import('@/lib/stripe/sync-subscription');
    const session = {
      id: 'cs_bad',
      customer: CUSTOMER,
      metadata: { kind: 'restart', tenant_id: TENANT },
      subscription: stripeSub('sub_restart', 'price_lite_m'),
    } as unknown as Stripe.Checkout.Session;
    await expect(syncRestartSession(session)).rejects.toThrow(/does not own the Stripe customer/);
    expect(subs).toHaveLength(0);
  });
});
