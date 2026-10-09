import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '11111111-1111-4111-8111-111111111111';

type SubRow = {
  product: string;
  source: string;
  status: string;
  stripe_subscription_id: string | null;
  included_workers_override?: number | null;
};

let subRows: SubRow[];
let teamCount: number | null;
let stripeSub: {
  id: string;
  status: string;
  metadata?: Record<string, string>;
  items: { data: Array<{ id: string; price: { id: string }; quantity: number | null }> };
};
const stripeCalls: Array<{ method: string; args: unknown[] }> = [];
let stripeError: Error | null;

const ENV = {
  STRIPE_PRICE_EXTRA_WORKER_STARTER: 'price_extra_starter',
  STRIPE_PRICE_EXTRA_WORKER_GROWTH: 'price_extra_growth',
  STRIPE_PRICE_EXTRA_WORKER_PRO: 'price_extra_pro',
} as const;
const PLAN_ENV = {
  STRIPE_PRICE_STARTER: 'price_starter',
  STRIPE_PRICE_STARTER_YEARLY: 'price_starter_y',
  STRIPE_PRICE_GROWTH: 'price_growth',
  STRIPE_PRICE_GROWTH_YEARLY: 'price_growth_y',
  STRIPE_PRICE_EXTRA_WORKER_STARTER_YEARLY: 'price_extra_starter_y',
  STRIPE_PRICE_EXTRA_WORKER_GROWTH_YEARLY: 'price_extra_growth_y',
} as const;
const saved: Record<string, string | undefined> = {};

vi.mock('next/server', () => ({ after: (fn: () => unknown) => void fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => fakeClient() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fakeClient() }));
vi.mock('@/lib/data/workers', () => ({ countTeamWorkers: async () => teamCount }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    subscriptions: {
      retrieve: async () => stripeSub,
      update: async (...args: unknown[]) => record('subscription.update', args),
    },
    subscriptionItems: {
      create: async (...args: unknown[]) => record('create', args),
      update: async (...args: unknown[]) => record('update', args),
      del: async (...args: unknown[]) => record('del', args),
    },
  }),
}));

function record(method: string, args: unknown[]) {
  if (stripeError) throw stripeError;
  stripeCalls.push({ method, args });
  return {};
}

function fakeClient() {
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    returns: () => Promise.resolve({ data: subRows, error: null }),
  };
  return { from: () => query } as never;
}

const row = (over: Partial<SubRow> = {}): SubRow => ({
  product: 'starter',
  source: 'stripe',
  status: 'active',
  stripe_subscription_id: 'sub_1',
  included_workers_override: null,
  ...over,
});

const plan = { id: 'si_plan', price: { id: 'price_starter' }, quantity: 1 };

async function run() {
  const { reconcileExtraWorkers } = await import('@/lib/billing/extra-workers');
  return reconcileExtraWorkers(TENANT);
}

beforeEach(() => {
  for (const [k, v] of Object.entries({ ...ENV, ...PLAN_ENV })) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  subRows = [row()];
  teamCount = 12; // Starter includes 10: 2 over
  stripeSub = { id: 'sub_1', status: 'active', items: { data: [plan] } };
  stripeCalls.length = 0;
  stripeError = null;
});

afterEach(() => {
  for (const k of [...Object.keys(ENV), ...Object.keys(PLAN_ENV)]) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('reconcileExtraWorkers', () => {
  it('adds an extra-worker line of the right size when over', async () => {
    const result = await run();
    expect(result).toEqual({ outcome: 'added', over: 2 });
    expect(stripeCalls).toEqual([
      {
        method: 'create',
        args: [{ subscription: 'sub_1', price: 'price_extra_starter', quantity: 2, proration_behavior: 'create_prorations' }],
      },
    ]);
  });

  it('updates the quantity when the line already exists', async () => {
    stripeSub.items.data.push({ id: 'si_extra', price: { id: 'price_extra_starter' }, quantity: 1 });
    const result = await run();
    expect(result).toEqual({ outcome: 'updated', over: 2 });
    expect(stripeCalls[0].method).toBe('update');
    expect(stripeCalls[0].args[0]).toBe('si_extra');
  });

  it('removes the line when the team is back within the allowance', async () => {
    teamCount = 10;
    stripeSub.items.data.push({ id: 'si_extra', price: { id: 'price_extra_starter' }, quantity: 2 });
    const result = await run();
    expect(result).toEqual({ outcome: 'removed', over: 0 });
    expect(stripeCalls[0].method).toBe('del');
  });

  it('changes nothing when the line is already right', async () => {
    stripeSub.items.data.push({ id: 'si_extra', price: { id: 'price_extra_starter' }, quantity: 2 });
    expect(await run()).toEqual({ outcome: 'unchanged', over: 2 });
    expect(stripeCalls).toEqual([]);
  });

  it('never touches the plan line', async () => {
    await run();
    expect(JSON.stringify(stripeCalls)).not.toContain('si_plan');
    expect(JSON.stringify(stripeCalls)).not.toContain('price_starter"');
  });

  it('never touches a manual account', async () => {
    subRows = [row({ source: 'manual', status: 'manual', stripe_subscription_id: null })];
    expect(await run()).toEqual({ outcome: 'skipped', reason: 'manual account' });
    expect(stripeCalls).toEqual([]);
  });

  it('honours a custom included count', async () => {
    subRows = [row({ included_workers_override: 15 })];
    expect(await run()).toEqual({ outcome: 'unchanged', over: 0 });
    expect(stripeCalls).toEqual([]);
  });

  it('uses the growth price for a growth business', async () => {
    subRows = [row({ product: 'growth' })];
    teamCount = 40; // Growth includes 35
    await run();
    expect(stripeCalls[0].args[0]).toMatchObject({ price: 'price_extra_growth', quantity: 5 });
  });

  it('changes nothing when it cannot count the team', async () => {
    teamCount = null;
    expect((await run()).outcome).toBe('skipped');
    expect(stripeCalls).toEqual([]);
  });

  it('changes nothing when the prices are not configured', async () => {
    for (const k of Object.keys(ENV)) delete process.env[k];
    expect(await run()).toEqual({ outcome: 'skipped', reason: 'extra-worker prices not configured' });
    expect(stripeCalls).toEqual([]);
  });

  it('skips a subscription that has ended', async () => {
    stripeSub.status = 'canceled';
    expect((await run()).outcome).toBe('skipped');
    expect(stripeCalls).toEqual([]);
  });

  it('reports a Stripe failure instead of throwing', async () => {
    stripeError = new Error('stripe down');
    expect(await run()).toEqual({ outcome: 'error', message: 'stripe down' });
  });

  it('monthly: uses the monthly extra price and rolls the change into the next bill', async () => {
    await run();
    expect(stripeCalls[0].args[0]).toMatchObject({ price: 'price_extra_starter', proration_behavior: 'create_prorations' });
  });

  it('yearly: uses the yearly extra price and charges the part-year at once', async () => {
    stripeSub.items.data = [{ id: 'si_plan', price: { id: 'price_starter_y' }, quantity: 1 }];
    const result = await run();
    expect(result).toEqual({ outcome: 'added', over: 2 });
    expect(stripeCalls[0]).toEqual({
      method: 'create',
      args: [{ subscription: 'sub_1', price: 'price_extra_starter_y', quantity: 2, proration_behavior: 'always_invoice' }],
    });
  });

  it('yearly: updates and removes with always_invoice too', async () => {
    stripeSub.items.data = [
      { id: 'si_plan', price: { id: 'price_starter_y' }, quantity: 1 },
      { id: 'si_extra', price: { id: 'price_extra_starter_y' }, quantity: 1 },
    ];
    await run();
    expect(stripeCalls[0]).toMatchObject({ method: 'update', args: ['si_extra', { quantity: 2, proration_behavior: 'always_invoice' }] });
    stripeCalls.length = 0;
    teamCount = 10;
    await run();
    expect(stripeCalls[0]).toMatchObject({ method: 'del', args: ['si_extra', { proration_behavior: 'always_invoice' }] });
  });

  it('yearly: picks the yearly price of the right tier', async () => {
    subRows = [row({ product: 'growth' })];
    teamCount = 40;
    stripeSub.items.data = [{ id: 'si_plan', price: { id: 'price_growth_y' }, quantity: 1 }];
    await run();
    expect(stripeCalls[0].args[0]).toMatchObject({ price: 'price_extra_growth_y', quantity: 5 });
  });

  it('swaps the price when the plan line moved to a different interval', async () => {
    stripeSub.items.data = [
      { id: 'si_plan', price: { id: 'price_starter_y' }, quantity: 1 },
      { id: 'si_extra', price: { id: 'price_extra_starter' }, quantity: 2 },
    ];
    const result = await run();
    expect(result).toEqual({ outcome: 'updated', over: 2 });
    expect(stripeCalls[0]).toMatchObject({ method: 'update', args: ['si_extra', { price: 'price_extra_starter_y', quantity: 2 }] });
  });

  it('skips when the plan line is not a known Pro price', async () => {
    stripeSub.items.data = [{ id: 'si_x', price: { id: 'price_mystery' }, quantity: 1 }];
    expect(await run()).toEqual({ outcome: 'skipped', reason: 'plan line not recognised' });
    expect(stripeCalls).toEqual([]);
  });

  it('keeps extras paid for at signup until the team reaches that size', async () => {
    subRows = [row({ product: 'growth' })];
    teamCount = 0;
    stripeSub.metadata = { expected_workers: '40' };
    stripeSub.items.data = [
      { id: 'si_plan', price: { id: 'price_growth' }, quantity: 1 },
      { id: 'si_extra', price: { id: 'price_extra_growth' }, quantity: 5 },
    ];
    expect(await run()).toEqual({ outcome: 'unchanged', over: 5 });
    expect(stripeCalls).toEqual([]);
  });

  it('drops the signup hold once the team has caught that size', async () => {
    subRows = [row({ product: 'growth' })];
    teamCount = 40;
    stripeSub.metadata = { expected_workers: '40' };
    stripeSub.items.data = [
      { id: 'si_plan', price: { id: 'price_growth' }, quantity: 1 },
      { id: 'si_extra', price: { id: 'price_extra_growth' }, quantity: 5 },
    ];
    expect(await run()).toEqual({ outcome: 'unchanged', over: 5 });
    expect(stripeCalls).toEqual([
      { method: 'subscription.update', args: ['sub_1', { metadata: { expected_workers: '' } }] },
    ]);
  });

  it('yearly: skips when the yearly extra price is not configured', async () => {
    delete process.env.STRIPE_PRICE_EXTRA_WORKER_STARTER_YEARLY;
    stripeSub.items.data = [{ id: 'si_plan', price: { id: 'price_starter_y' }, quantity: 1 }];
    expect(await run()).toEqual({ outcome: 'skipped', reason: 'extra-worker prices not configured' });
    expect(stripeCalls).toEqual([]);
  });
});
