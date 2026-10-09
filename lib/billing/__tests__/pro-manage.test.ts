import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = { product: string; source: string; status: string; stripe_subscription_id: string | null; billing_interval?: string; included_workers_override?: number | null };

let subRow: Row | null;
let team: number | null;
let sub: Record<string, unknown>;
let previewAmount: number;
let updateResult: Record<string, unknown>;
let updateError: Error | null;
const calls: Array<{ method: string; args: unknown[] }> = [];
const syncSubscription = vi.fn();
const reconcileExtraWorkers = vi.fn();

vi.mock('server-only', () => ({}));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    subscriptions: {
      retrieve: async () => sub,
      update: async (...args: unknown[]) => {
        calls.push({ method: 'update', args });
        if (updateError) throw updateError;
        return updateResult;
      },
    },
    invoices: {
      createPreview: async (...args: unknown[]) => {
        calls.push({ method: 'preview', args });
        return { amount_due: previewAmount };
      },
    },
  }),
}));
vi.mock('@/lib/stripe/sync-subscription', () => ({ syncSubscription: (...a: unknown[]) => syncSubscription(...a) }));
vi.mock('@/lib/billing/extra-workers', () => ({ reconcileExtraWorkers: (...a: unknown[]) => reconcileExtraWorkers(...a) }));
vi.mock('@/lib/data/workers', () => ({ countTeamWorkers: async () => team }));
vi.mock('@/lib/data/worker-allowance', async () => {
  const pro = await vi.importActual<typeof import('@/lib/billing/pro-allowance')>('@/lib/billing/pro-allowance');
  return {
    loadProSubscription: async () => subRow,
    allowanceFor: (row: Row, used: number) =>
      pro.computeAllowance({
        tier: row.product as 'starter' | 'growth' | 'pro',
        source: row.source === 'manual' ? 'manual' : 'stripe',
        includedOverride: row.included_workers_override ?? null,
        used,
      }),
  };
});
vi.mock('@/lib/billing/manage', () => ({
  hostedUrl: async (invoice: unknown) => (invoice && typeof invoice === 'object' ? ((invoice as { hosted_invoice_url?: string }).hosted_invoice_url ?? null) : null),
  logStripe: () => undefined,
  periodEndUnix: () => 1_800_000_000,
}));

const ENV = {
  STRIPE_PRICE_STARTER: 'price_starter',
  STRIPE_PRICE_GROWTH: 'price_growth',
  STRIPE_PRICE_PRO: 'price_pro',
  STRIPE_PRICE_EXTRA_WORKER_STARTER: 'price_extra_starter',
  STRIPE_PRICE_EXTRA_WORKER_GROWTH: 'price_extra_growth',
  STRIPE_PRICE_EXTRA_WORKER_PRO: 'price_extra_pro',
} as const;
const saved: Record<string, string | undefined> = {};

function baseSub(over: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    status: 'active',
    customer: 'cus_1',
    cancel_at_period_end: false,
    pending_update: null,
    items: {
      data: [
        { id: 'si_plan', price: { id: 'price_starter' }, quantity: 1 },
        { id: 'si_extra', price: { id: 'price_extra_starter' }, quantity: 10 },
      ],
    },
    ...over,
  };
}

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  subRow = { product: 'starter', source: 'stripe', status: 'active', stripe_subscription_id: 'sub_1', billing_interval: 'month', included_workers_override: null };
  team = 20;
  sub = baseSub();
  previewAmount = 25000;
  updateResult = { ...baseSub(), id: 'sub_1' };
  updateError = null;
  calls.length = 0;
  syncSubscription.mockReset();
  reconcileExtraWorkers.mockReset();
  syncSubscription.mockResolvedValue({ synced: true });
  reconcileExtraWorkers.mockResolvedValue({ outcome: 'unchanged', over: 0 });
});

afterEach(() => {
  for (const k of Object.keys(ENV)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const lib = () => import('@/lib/billing/pro-manage');

describe('previewProUpgrade', () => {
  it('Starter team 20 → Growth: the extra line goes away (35 included), amount from Stripe', async () => {
    const { previewProUpgrade } = await lib();
    const result = await previewProUpgrade('t1', 'growth');
    expect(result).toMatchObject({ ok: true, target: 'growth', interval: 'month', todayPence: 25000, thenLabel: '£449 a month', overAfter: 0, includedAfter: 35 });
    const previewCall = calls.find((c) => c.method === 'preview');
    expect(previewCall?.args[0]).toMatchObject({
      customer: 'cus_1',
      subscription: 'sub_1',
      subscription_details: {
        proration_behavior: 'always_invoice',
        items: [{ id: 'si_plan', price: 'price_growth' }, { id: 'si_extra', deleted: true }],
      },
    });
  });

  it('team 40 → Growth: the extra line is swapped to the Growth price at quantity 5', async () => {
    team = 40;
    const { previewProUpgrade } = await lib();
    const result = await previewProUpgrade('t1', 'growth');
    expect(result).toMatchObject({ ok: true, overAfter: 5 });
    expect(calls.find((c) => c.method === 'preview')?.args[0]).toMatchObject({
      subscription_details: { items: [{ id: 'si_plan', price: 'price_growth' }, { id: 'si_extra', price: 'price_extra_growth', quantity: 5 }] },
    });
  });

  it('refuses manual accounts, a custom allowance, going down, the same tier, and bad input', async () => {
    const { previewProUpgrade } = await lib();
    subRow = { product: 'pro', source: 'manual', status: 'manual', stripe_subscription_id: null };
    expect(await previewProUpgrade('t1', 'growth')).toEqual({ ok: false, error: 'Your plan is managed by WorkWise. Contact us to make changes.' });
    subRow = { product: 'starter', source: 'stripe', status: 'active', stripe_subscription_id: 'sub_1', included_workers_override: 15 };
    expect(await previewProUpgrade('t1', 'growth')).toEqual({ ok: false, error: 'Your plan has a custom set-up, so contact us to change it.' });
    subRow = { product: 'starter', source: 'stripe', status: 'active', stripe_subscription_id: 'sub_1', included_workers_override: null };
    sub = baseSub({ items: { data: [{ id: 'si_plan', price: { id: 'price_growth' }, quantity: 1 }] } });
    expect(await previewProUpgrade('t1', 'starter')).toMatchObject({ ok: false });
    expect(await previewProUpgrade('t1', 'growth')).toMatchObject({ ok: false });
    expect(await previewProUpgrade('t1', 'nonsense' as never)).toMatchObject({ ok: false });
    expect(calls.filter((c) => c.method === 'preview')).toEqual([]);
  });

  it('refuses while a cancellation is pending, the payment is overdue, or a change is waiting', async () => {
    const { previewProUpgrade } = await lib();
    sub = baseSub({ cancel_at_period_end: true });
    expect(await previewProUpgrade('t1', 'growth')).toEqual({ ok: false, error: 'Undo your cancellation first.' });
    sub = baseSub({ status: 'past_due' });
    expect(await previewProUpgrade('t1', 'growth')).toEqual({ ok: false, error: 'Update your card first, then you can change your plan.' });
    sub = baseSub({ pending_update: { expires_at: 1 } });
    expect(await previewProUpgrade('t1', 'growth')).toMatchObject({ ok: false });
  });

  it('is a plain error when Stripe fails', async () => {
    const { previewProUpgrade } = await lib();
    sub = undefined as never;
    expect(await previewProUpgrade('t1', 'growth')).toEqual({ ok: false, error: "Couldn't change your plan. Nothing was charged. Please try again." });
  });
});

describe('upgradeProTier', () => {
  it('re-previews, checks the amount, updates with the right items and key, syncs, then reconciles', async () => {
    const { upgradeProTier } = await lib();
    const result = await upgradeProTier('t1', 'growth', 25000, 'nonce-12345678');
    expect(result).toEqual({ ok: true, applied: 'now' });
    const update = calls.find((c) => c.method === 'update')!;
    expect(update.args[0]).toBe('sub_1');
    expect(update.args[1]).toMatchObject({
      items: [{ id: 'si_plan', price: 'price_growth' }, { id: 'si_extra', deleted: true }],
      proration_behavior: 'always_invoice',
      payment_behavior: 'pending_if_incomplete',
    });
    expect(update.args[2]).toEqual({ idempotencyKey: 'pro-upgrade-t1-nonce-12345678' });
    expect(syncSubscription).toHaveBeenCalledTimes(1);
    expect(reconcileExtraWorkers).toHaveBeenCalledWith('t1', undefined);
  });

  it('refuses when the amount moved since the dialog, and shows the fresh preview', async () => {
    const { upgradeProTier } = await lib();
    const result = await upgradeProTier('t1', 'growth', 20000, 'nonce-12345678');
    expect(result).toMatchObject({ ok: false, error: 'The amount has changed. Please check it and confirm again.', preview: { ok: true, todayPence: 25000 } });
    expect(calls.find((c) => c.method === 'update')).toBeUndefined();
  });

  it('allows one penny of drift', async () => {
    const { upgradeProTier } = await lib();
    expect(await upgradeProTier('t1', 'growth', 24999, 'nonce-12345678')).toEqual({ ok: true, applied: 'now' });
  });

  it('returns the hosted invoice when the bank needs the customer to confirm', async () => {
    updateResult = { ...baseSub(), pending_update: { expires_at: 1 }, latest_invoice: { hosted_invoice_url: 'https://pay.stripe.test/i/1' } };
    const { upgradeProTier } = await lib();
    expect(await upgradeProTier('t1', 'growth', 25000, 'nonce-12345678')).toEqual({
      ok: true,
      needsAction: { hostedInvoiceUrl: 'https://pay.stripe.test/i/1' },
    });
    expect(syncSubscription).not.toHaveBeenCalled();
  });

  it('is an error, with nothing assumed done, when Stripe refuses', async () => {
    updateError = new Error('card declined');
    const { upgradeProTier } = await lib();
    expect(await upgradeProTier('t1', 'growth', 25000, 'nonce-12345678')).toEqual({
      ok: false,
      error: "Couldn't change your plan. Nothing was charged. Please try again.",
    });
    expect(syncSubscription).not.toHaveBeenCalled();
  });

  it('still succeeds if our own sync fails afterwards, and then does NOT run the extra-worker safety net', async () => {
    syncSubscription.mockRejectedValue(new Error('db down'));
    const { upgradeProTier } = await lib();
    expect(await upgradeProTier('t1', 'growth', 25000, 'nonce-12345678')).toEqual({ ok: true, applied: 'now' });
    // Our rows still say the old tier, so reconciling now would put the extra line back to the old tier's price.
    expect(reconcileExtraWorkers).not.toHaveBeenCalled();
  });

  it('does not run the safety net when the sync found no business to update', async () => {
    syncSubscription.mockResolvedValue({ synced: false, reason: 'no_tenant' });
    const { upgradeProTier } = await lib();
    expect(await upgradeProTier('t1', 'growth', 25000, 'nonce-12345678')).toEqual({ ok: true, applied: 'now' });
    expect(reconcileExtraWorkers).not.toHaveBeenCalled();
  });

  it('refuses a bad nonce or amount before any Stripe call', async () => {
    const { upgradeProTier } = await lib();
    expect(await upgradeProTier('t1', 'growth', 25000, 'x')).toMatchObject({ ok: false });
    expect(await upgradeProTier('t1', 'growth', Number.NaN, 'nonce-12345678')).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });
});

describe('cancel and undo', () => {
  it('cancels at the end of the period, and says when it ends', async () => {
    updateResult = { ...baseSub(), cancel_at_period_end: true };
    const { cancelProPlan } = await lib();
    const result = await cancelProPlan('t1');
    expect(result).toEqual({ ok: true, endsOn: new Date(1_800_000_000 * 1000).toISOString() });
    expect(calls.find((c) => c.method === 'update')?.args).toEqual(['sub_1', { cancel_at_period_end: true }]);
  });

  it('is idempotent when already ending', async () => {
    sub = baseSub({ cancel_at_period_end: true });
    const { cancelProPlan } = await lib();
    expect(await cancelProPlan('t1')).toMatchObject({ ok: true });
    expect(calls.find((c) => c.method === 'update')).toBeUndefined();
  });

  it('undo clears the cancellation, and is a no-op when not ending', async () => {
    const { undoProCancel } = await lib();
    sub = baseSub({ cancel_at_period_end: true });
    expect(await undoProCancel('t1')).toEqual({ ok: true });
    expect(calls.find((c) => c.method === 'update')?.args).toEqual(['sub_1', { cancel_at_period_end: false }]);
    calls.length = 0;
    sub = baseSub();
    expect(await undoProCancel('t1')).toEqual({ ok: true });
    expect(calls).toEqual([]);
  });

  it('never touches a manual account', async () => {
    subRow = { product: 'pro', source: 'manual', status: 'manual', stripe_subscription_id: null };
    const { cancelProPlan, undoProCancel } = await lib();
    expect(await cancelProPlan('t1')).toMatchObject({ ok: false });
    expect(await undoProCancel('t1')).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });
});
