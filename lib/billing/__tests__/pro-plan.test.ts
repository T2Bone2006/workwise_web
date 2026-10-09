import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let isAdmin: boolean;
let subRow: { product: string; source: string; status: string; stripe_subscription_id: string | null } | null;
let stripeSub: Record<string, unknown>;
let allowance: { used: number; included: number; over: number } | null;

vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({ subscriptions: { retrieve: async () => stripeSub } }),
}));
vi.mock('@/lib/data/worker-allowance', () => ({
  loadProSubscription: async () => subRow,
  loadWorkerAllowance: async () => allowance,
}));
vi.mock('@/lib/billing/manage', () => ({
  currentUserIsAdminOf: async () => isAdmin,
  discountSummary: async () => null,
  customerBitsOf: async () => ({ creditPence: 0, card: null }),
  nextBillOf: async () => ({ date: '2026-11-08T00:00:00.000Z', amountPence: 22200 }),
  invoicesOf: async () => [],
  cardFrom: async () => ({ brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 }),
  periodEndUnix: () => 1_794_000_000,
  iso: (n: number | null | undefined) => (n ? new Date(n * 1000).toISOString() : null),
  logStripe: () => undefined,
}));

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved.STRIPE_PRICE_STARTER = process.env.STRIPE_PRICE_STARTER;
  process.env.STRIPE_PRICE_STARTER = 'price_starter';
  saved.STRIPE_PRICE_EXTRA_WORKER_STARTER = process.env.STRIPE_PRICE_EXTRA_WORKER_STARTER;
  process.env.STRIPE_PRICE_EXTRA_WORKER_STARTER = 'price_extra_starter';
  isAdmin = true;
  subRow = { product: 'starter', source: 'stripe', status: 'active', stripe_subscription_id: 'sub_1' };
  allowance = { used: 13, included: 10, over: 3 };
  stripeSub = {
    id: 'sub_1',
    status: 'active',
    customer: 'cus_1',
    cancel_at_period_end: false,
    trial_end: null,
    default_payment_method: null,
    items: {
      data: [
        { id: 'si_extra', price: { id: 'price_extra_starter', unit_amount: 1200 }, quantity: 3 },
        { id: 'si_plan', price: { id: 'price_starter', unit_amount: 14900 }, quantity: 1 },
      ],
    },
  };
});

afterEach(() => {
  if (saved.STRIPE_PRICE_STARTER === undefined) delete process.env.STRIPE_PRICE_STARTER;
  else process.env.STRIPE_PRICE_STARTER = saved.STRIPE_PRICE_STARTER;
  if (saved.STRIPE_PRICE_EXTRA_WORKER_STARTER === undefined) delete process.env.STRIPE_PRICE_EXTRA_WORKER_STARTER;
  else process.env.STRIPE_PRICE_EXTRA_WORKER_STARTER = saved.STRIPE_PRICE_EXTRA_WORKER_STARTER;
});

async function summary() {
  const { getProPlanSummary } = await import('@/lib/billing/pro-plan');
  return getProPlanSummary('tenant-1');
}

describe('getProPlanSummary', () => {
  it('shows the plan, the extra workers and the monthly total', async () => {
    const result = await summary();
    expect(result).toMatchObject({
      kind: 'pro',
      tier: 'starter',
      tierName: 'Starter',
      status: 'active',
      used: 13,
      included: 10,
      over: 3,
      monthlyPence: 18500,
      nextBill: { amountPence: 22200 },
      card: { last4: '4242' },
    });
    expect((result as { lines: unknown[] }).lines).toEqual([
      { label: 'Starter plan', quantity: 1, unitPence: 14900, totalPence: 14900 },
      { label: 'Extra workers', quantity: 3, unitPence: 1200, totalPence: 3600 },
    ]);
  });

  it('shows just the plan when there are no extras', async () => {
    (stripeSub.items as { data: unknown[] }).data = [
      { id: 'si_plan', price: { id: 'price_starter', unit_amount: 14900 }, quantity: 1 },
    ];
    allowance = { used: 8, included: 10, over: 0 };
    expect(await summary()).toMatchObject({ kind: 'pro', monthlyPence: 14900, over: 0 });
  });

  it('says which tiers can be upgraded to, and none when blocked', async () => {
    expect(await summary()).toMatchObject({ kind: 'pro', canUpgradeTo: ['growth', 'pro'], upgradeBlockedReason: null });
    subRow = { ...subRow!, included_workers_override: 15 } as typeof subRow;
    expect(await summary()).toMatchObject({ canUpgradeTo: [], upgradeBlockedReason: 'custom' });
    subRow = { ...subRow!, included_workers_override: null } as typeof subRow;
    stripeSub.cancel_at_period_end = true;
    expect(await summary()).toMatchObject({ canUpgradeTo: [], upgradeBlockedReason: 'ending' });
    stripeSub.cancel_at_period_end = false;
    stripeSub.status = 'past_due';
    expect(await summary()).toMatchObject({ canUpgradeTo: [], upgradeBlockedReason: 'overdue' });
  });

  it('a yearly plan reports yearly and uses the yearly prices', async () => {
    process.env.STRIPE_PRICE_STARTER_YEARLY = 'price_starter_y';
    process.env.STRIPE_PRICE_EXTRA_WORKER_STARTER_YEARLY = 'price_extra_starter_y';
    subRow = { ...subRow!, billing_interval: 'year' } as typeof subRow;
    stripeSub.items = {
      data: [
        { id: 'si_plan', price: { id: 'price_starter_y', unit_amount: 149000 }, quantity: 1 },
        { id: 'si_extra', price: { id: 'price_extra_starter_y', unit_amount: 12000 }, quantity: 3 },
      ],
    };
    const result = await summary();
    expect(result).toMatchObject({ kind: 'pro', interval: 'year', monthlyPence: 149000 + 36000 });
    delete process.env.STRIPE_PRICE_STARTER_YEARLY;
    delete process.env.STRIPE_PRICE_EXTRA_WORKER_STARTER_YEARLY;
  });

  it('keeps manual accounts and non-owners on the managed tab', async () => {
    subRow = { product: 'pro', source: 'manual', status: 'manual', stripe_subscription_id: null };
    expect(await summary()).toEqual({ kind: 'managed' });
    subRow = { product: 'starter', source: 'stripe', status: 'active', stripe_subscription_id: 'sub_1' };
    isAdmin = false;
    expect(await summary()).toEqual({ kind: 'managed' });
  });

  it('says unavailable when the plan line is not one we know, or the subscription ended', async () => {
    (stripeSub.items as { data: unknown[] }).data = [
      { id: 'si_x', price: { id: 'price_mystery', unit_amount: 100 }, quantity: 1 },
    ];
    expect(await summary()).toEqual({ kind: 'unavailable' });
    (stripeSub.items as { data: unknown[] }).data = [
      { id: 'si_plan', price: { id: 'price_starter', unit_amount: 14900 }, quantity: 1 },
    ];
    stripeSub.status = 'canceled';
    expect(await summary()).toEqual({ kind: 'unavailable' });
  });
});
