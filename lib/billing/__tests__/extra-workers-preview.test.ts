import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SubRow = { product: string; source: string; status: string; stripe_subscription_id: string | null; included_workers_override?: number | null };

let subRows: SubRow[];
let teamCount: number | null;
let stripeSub: { id: string; status: string; customer: string; items: { data: Array<{ id: string; price: { id: string }; quantity: number | null }> } };
let previewLines: Array<Record<string, unknown>>;
let previewError: Error | null;
const previewCalls: unknown[] = [];

const ENV = {
  STRIPE_PRICE_STARTER: 'price_starter',
  STRIPE_PRICE_STARTER_YEARLY: 'price_starter_y',
  STRIPE_PRICE_EXTRA_WORKER_STARTER: 'price_extra_starter',
  STRIPE_PRICE_EXTRA_WORKER_STARTER_YEARLY: 'price_extra_starter_y',
} as const;
const saved: Record<string, string | undefined> = {};

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => fakeClient() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fakeClient() }));
vi.mock('@/lib/data/workers', () => ({ countTeamWorkers: async () => teamCount }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    subscriptions: { retrieve: async () => stripeSub },
    invoices: {
      createPreview: async (params: unknown) => {
        previewCalls.push(params);
        if (previewError) throw previewError;
        return { lines: { data: previewLines } };
      },
    },
  }),
}));

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

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  subRows = [row()];
  teamCount = 10;
  stripeSub = { id: 'sub_1', status: 'active', customer: 'cus_1', items: { data: [{ id: 'si_plan', price: { id: 'price_starter_y' }, quantity: 1 }] } };
  previewLines = [];
  previewError = null;
  previewCalls.length = 0;
});

afterEach(() => {
  for (const k of Object.keys(ENV)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function preview(workersToAdd = 1) {
  const { previewExtraWorkerCharge } = await import('@/lib/billing/extra-workers-preview');
  return previewExtraWorkerCharge('tenant-1', workersToAdd);
}

describe('chargeNowFromPreviewLines', () => {
  it('sums only the proration lines', async () => {
    const { chargeNowFromPreviewLines } = await import('@/lib/billing/extra-workers-preview');
    expect(
      chargeNowFromPreviewLines([
        { amount: 6000, proration: true },
        { amount: 12000, proration: false },
        { amount: -500, proration: true },
      ]),
    ).toBe(5500);
    expect(chargeNowFromPreviewLines([])).toBe(0);
  });
});

describe('previewExtraWorkerCharge', () => {
  it('yearly: returns the exact pro-rata amount from Stripe and the renewal figure', async () => {
    previewLines = [
      { amount: 5836, parent: { subscription_item_details: { proration: true } } },
      { amount: 12000, parent: { subscription_item_details: { proration: false } } },
    ];
    const result = await preview(1);
    expect(result).toEqual({ ok: true, interval: 'year', extrasAfter: 1, perWorkerPence: 12000, chargeNowPence: 5836, renewalExtrasPence: 12000 });
    expect(previewCalls[0]).toMatchObject({
      customer: 'cus_1',
      subscription: 'sub_1',
      subscription_details: { items: [{ price: 'price_extra_starter_y', quantity: 1 }], proration_behavior: 'always_invoice' },
    });
  });

  it('yearly with an existing extra line: sets the new quantity on that line', async () => {
    teamCount = 12;
    stripeSub.items.data.push({ id: 'si_extra', price: { id: 'price_extra_starter_y' }, quantity: 2 });
    await preview(1);
    expect(previewCalls[0]).toMatchObject({ subscription_details: { items: [{ id: 'si_extra', quantity: 3 }] } });
  });

  it('monthly: no Stripe preview, nothing charged now', async () => {
    stripeSub.items.data = [{ id: 'si_plan', price: { id: 'price_starter' }, quantity: 1 }];
    const result = await preview(1);
    expect(result).toEqual({ ok: true, interval: 'month', extrasAfter: 1, perWorkerPence: 1200, chargeNowPence: null, renewalExtrasPence: null });
    expect(previewCalls).toEqual([]);
  });

  it('is not ok for a manual account, no subscription, nothing over the allowance, or a bad count', async () => {
    subRows = [row({ source: 'manual', status: 'manual', stripe_subscription_id: null })];
    expect(await preview()).toEqual({ ok: false });
    subRows = [];
    expect(await preview()).toEqual({ ok: false });
    subRows = [row()];
    teamCount = 5;
    expect(await preview(1)).toEqual({ ok: false });
    teamCount = 10;
    expect(await preview(0)).toEqual({ ok: false });
    expect(await preview(-2)).toEqual({ ok: false });
    teamCount = null;
    expect(await preview(1)).toEqual({ ok: false });
  });

  it('counts a batch: adding 5 to a team of 10 puts 5 over', async () => {
    previewLines = [{ amount: 30000, parent: { subscription_item_details: { proration: true } } }];
    const result = await preview(5);
    expect(result).toMatchObject({ ok: true, extrasAfter: 5, chargeNowPence: 30000, renewalExtrasPence: 60000 });
  });

  it('never throws: a Stripe error is { ok: false }', async () => {
    previewError = new Error('stripe down');
    expect(await preview(1)).toEqual({ ok: false });
  });

  it('is not ok when the plan line is not a known Pro price', async () => {
    stripeSub.items.data = [{ id: 'si_x', price: { id: 'price_mystery' }, quantity: 1 }];
    expect(await preview(1)).toEqual({ ok: false });
  });
});
