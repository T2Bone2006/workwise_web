import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

type Settings = {
  enabled: boolean;
  pack_key: 'texts_250' | 'texts_1000';
  trigger_left: number;
  monthly_cap_pence: number;
  paused_reason: string | null;
} | null;

let settings: Settings;
let card: { id: string; brand: string; last4: string; customerId: string } | null;
vi.mock('@/lib/messaging/auto-top-up', () => ({
  getAutoTopUp: async () => settings,
  findChargeableCard: async () => card,
}));

const releaseWaitingForTenant = vi.fn(async () => ({}));
vi.mock('@/lib/messaging/release-waiting', () => ({
  releaseWaitingForTenant: (...a: unknown[]) => releaseWaitingForTenant(...(a as [])),
}));
vi.mock('@/lib/messaging/rounds-tenants', () => ({ listRoundsTenantIds: async () => ['t1'] }));
vi.mock('@/lib/messaging/text-allowance', () => ({ textAllowanceFor: async () => 100 }));
const sendOwnerEmail = vi.fn(async () => ({ ok: true }));
vi.mock('@/lib/emails/owner-notice', () => ({
  ownerEmailFor: async () => 'owner@example.com',
  sendOwnerEmail: (...a: unknown[]) => sendOwnerEmail(...(a as [])),
}));
vi.mock('@/lib/messaging/low-texts', () => ({ checkTextWarnings: async () => ({ sent: null }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fake }));

const pricesRetrieve = vi.fn();
const intentsCreate = vi.fn();
const intentsCancel = vi.fn(async () => ({}));
const intentsRetrieve = vi.fn();
const intentsSearch = vi.fn();
vi.mock('@/lib/stripe/client', () => ({
  getAppUrl: () => 'http://localhost:3000',
  getStripe: () => ({
    prices: { retrieve: pricesRetrieve },
    paymentIntents: { create: intentsCreate, cancel: intentsCancel, retrieve: intentsRetrieve, search: intentsSearch },
  }),
}));

type Charge = {
  id: string;
  tenant_id: string;
  day_key: string;
  month: string;
  pack_key: string;
  texts: number;
  amount_pence: number;
  status: string;
  stripe_payment_intent_id: string | null;
  error?: string | null;
  created_at: string;
};
let charges: Charge[];
let balance: { month: string; month_used: number; pack_balance: number } | null;
let addPackCalls: Record<string, unknown>[];
let addPackResults: boolean[];
let fake: ReturnType<typeof build>;
let nextId: number;

function build() {
  return {
    rpc(name: string, args: Record<string, unknown>) {
      if (name === 'add_text_pack') {
        addPackCalls.push(args);
        return Promise.resolve({ data: addPackResults.shift() ?? true, error: null });
      }
      return Promise.resolve({ data: null, error: { message: 'unknown rpc' } });
    },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const inFilters: Record<string, unknown[]> = {};
      let patch: Record<string, unknown> | null = null;
      let inserted: Charge | null = null;
      const api: Record<string, unknown> = {
        select() {
          return api;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return api;
        },
        in(col: string, vals: unknown[]) {
          inFilters[col] = vals;
          return api;
        },
        lte() {
          return api;
        },
        is() {
          return api;
        },
        limit() {
          if (table === 'text_auto_topup_charges') {
            return Promise.resolve({ data: charges.filter((c) => c.status === 'pending'), error: null });
          }
          return Promise.resolve({ data: [], error: null });
        },
        insert(row: Record<string, unknown>) {
          const dup = charges.some((c) => c.tenant_id === row.tenant_id && c.day_key === row.day_key);
          if (!dup) {
            inserted = { ...(row as Charge), id: `ch${nextId++}`, stripe_payment_intent_id: null, created_at: '2026-11-18T12:00:00.000Z' };
            charges.push(inserted);
          }
          return {
            select: () => ({
              single: async () =>
                dup ? { data: null, error: { code: '23505', message: 'dup' } } : { data: { id: inserted!.id }, error: null },
            }),
          };
        },
        update(p: Record<string, unknown>) {
          patch = p;
          return api;
        },
        maybeSingle() {
          if (table === 'tenant_text_balance') return Promise.resolve({ data: balance, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve: (v: unknown) => unknown) {
          if (table === 'text_auto_topup_charges' && patch) {
            const row = charges.find((c) => c.id === filters.id);
            if (row) Object.assign(row, patch);
            return Promise.resolve({ error: null }).then(resolve);
          }
          if (table === 'text_auto_topup_charges') {
            const rows = charges.filter(
              (c) =>
                (filters.tenant_id == null || c.tenant_id === filters.tenant_id) &&
                (filters.month == null || c.month === filters.month) &&
                (inFilters.status == null || inFilters.status.includes(c.status)),
            );
            return Promise.resolve({ data: rows, error: null }).then(resolve);
          }
          if (table === 'text_auto_topup' && patch) {
            Object.assign(settings ?? {}, patch);
          }
          return Promise.resolve({ error: null }).then(resolve);
        },
      };
      return api;
    },
  };
}

const NOW = new Date('2026-11-18T12:00:00.000Z');
const NIGHT = new Date('2026-11-18T22:30:00.000Z');
const defaultSettings = (): Settings => ({
  enabled: true,
  pack_key: 'texts_250',
  trigger_left: 20,
  monthly_cap_pence: 5000,
  paused_reason: null,
});

async function load() {
  return import('@/lib/messaging/run-auto-top-up');
}

describe('maybeAutoTopUp', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.STRIPE_PRICE_TEXTS_250 = 'price_250';
    process.env.STRIPE_PRICE_TEXTS_1000 = 'price_1000';
    settings = defaultSettings();
    card = { id: 'pm_1', brand: 'visa', last4: '4242', customerId: 'cus_1' };
    charges = [];
    nextId = 1;
    balance = { month: '2026-11', month_used: 85, pack_balance: 0 }; // 15 left
    addPackCalls = [];
    addPackResults = [];
    releaseWaitingForTenant.mockClear();
    sendOwnerEmail.mockClear();
    pricesRetrieve.mockReset();
    pricesRetrieve.mockResolvedValue({ unit_amount: 1499, currency: 'gbp' });
    intentsCreate.mockReset();
    intentsCreate.mockResolvedValue({ id: 'pi_1', status: 'succeeded' });
    intentsRetrieve.mockReset();
    intentsSearch.mockReset();
    fake = build();
  });

  it('off, paused and not-needed do nothing and never touch Stripe', async () => {
    const { maybeAutoTopUp } = await load();
    settings = null;
    expect(await maybeAutoTopUp(fake as never, 't1', NOW)).toEqual({ result: 'off' });
    settings = { ...defaultSettings()!, enabled: false };
    expect(await maybeAutoTopUp(fake as never, 't1', NOW)).toEqual({ result: 'off' });
    settings = { ...defaultSettings()!, paused_reason: 'card_failed' };
    expect(await maybeAutoTopUp(fake as never, 't1', NOW)).toEqual({ result: 'paused' });
    settings = defaultSettings();
    balance = { month: '2026-11', month_used: 50, pack_balance: 0 }; // 50 left
    expect(await maybeAutoTopUp(fake as never, 't1', NOW)).toEqual({ result: 'not_needed' });
    expect(intentsCreate).not.toHaveBeenCalled();
  });

  it('charges once, credits the texts exactly once, releases waiting and sends a receipt', async () => {
    const { maybeAutoTopUp } = await load();
    const res = await maybeAutoTopUp(fake as never, 't1', NOW);
    expect(res).toEqual({ result: 'charged', texts: 300, amountPence: 1499 });
    expect(intentsCreate).toHaveBeenCalledOnce();
    const [params, opts] = intentsCreate.mock.calls[0] as [Record<string, unknown>, { idempotencyKey: string }];
    expect(params).toMatchObject({ amount: 1499, currency: 'gbp', off_session: true, confirm: true, payment_method: 'pm_1' });
    expect(opts.idempotencyKey).toBe('autotopup:ch1');
    expect(addPackCalls).toEqual([
      expect.objectContaining({ p_tenant_id: 't1', p_texts: 300, p_checkout_session_id: 'pi_1', p_payment_intent_id: 'pi_1' }),
    ]);
    expect(charges[0]).toMatchObject({ status: 'paid', stripe_payment_intent_id: 'pi_1' });
    expect(releaseWaitingForTenant).toHaveBeenCalledOnce();
    expect(sendOwnerEmail).toHaveBeenCalledOnce();
  });

  it('a second dip the same day does not charge again', async () => {
    const { maybeAutoTopUp } = await load();
    await maybeAutoTopUp(fake as never, 't1', NOW);
    intentsCreate.mockClear();
    expect(await maybeAutoTopUp(fake as never, 't1', NOW)).toEqual({ result: 'already_today' });
    expect(intentsCreate).not.toHaveBeenCalled();
  });

  it('two runners at once: only one reaches Stripe', async () => {
    const { maybeAutoTopUp } = await load();
    const [a, b] = await Promise.all([
      maybeAutoTopUp(fake as never, 't1', NOW),
      maybeAutoTopUp(fake as never, 't1', NOW),
    ]);
    expect([a.result, b.result].sort()).toEqual(['already_today', 'charged']);
    expect(intentsCreate).toHaveBeenCalledOnce();
  });

  it("never goes past the trader's monthly limit", async () => {
    charges.push({
      id: 'old', tenant_id: 't1', day_key: '2026-11-10', month: '2026-11', pack_key: 'texts_1000',
      texts: 1200, amount_pence: 4999, status: 'paid', stripe_payment_intent_id: 'pi_old', created_at: '2026-11-10T12:00:00.000Z',
    });
    const { maybeAutoTopUp } = await load();
    expect(await maybeAutoTopUp(fake as never, 't1', NOW)).toEqual({ result: 'cap_reached' });
    expect(intentsCreate).not.toHaveBeenCalled();
    expect(charges).toHaveLength(1);
  });

  it('quiet hours: nothing is charged at night', async () => {
    const { maybeAutoTopUp } = await load();
    expect(await maybeAutoTopUp(fake as never, 't1', NIGHT)).toEqual({ result: 'quiet_hours' });
    expect(intentsCreate).not.toHaveBeenCalled();
  });

  it('no card → it pauses and tells the owner', async () => {
    card = null;
    const { maybeAutoTopUp } = await load();
    expect(await maybeAutoTopUp(fake as never, 't1', NOW)).toEqual({ result: 'no_card' });
    expect(settings!.paused_reason).toBe('no_card');
    expect(sendOwnerEmail).toHaveBeenCalledOnce();
    expect(intentsCreate).not.toHaveBeenCalled();
  });

  it('a Stripe price that disagrees with the pack is never charged', async () => {
    pricesRetrieve.mockResolvedValue({ unit_amount: 999, currency: 'gbp' });
    const { maybeAutoTopUp } = await load();
    expect(await maybeAutoTopUp(fake as never, 't1', NOW)).toEqual({ result: 'failed', reason: 'price_mismatch' });
    expect(intentsCreate).not.toHaveBeenCalled();
    expect(charges).toHaveLength(0);
  });

  it('a card that needs the bank → paused, failed email, no retry', async () => {
    intentsCreate.mockRejectedValue({ type: 'StripeCardError', code: 'authentication_required', payment_intent: { id: 'pi_x' } });
    const { maybeAutoTopUp } = await load();
    expect(await maybeAutoTopUp(fake as never, 't1', NOW)).toEqual({ result: 'failed', reason: 'needs_authentication' });
    expect(settings!.paused_reason).toBe('needs_authentication');
    expect(charges[0]).toMatchObject({ status: 'failed' });
    expect(addPackCalls).toHaveLength(0);
    expect(sendOwnerEmail).toHaveBeenCalledOnce();
    // paused: the next dip does nothing
    intentsCreate.mockClear();
    expect(await maybeAutoTopUp(fake as never, 't1', NOW)).toEqual({ result: 'paused' });
    expect(intentsCreate).not.toHaveBeenCalled();
  });

  it('a payment that comes back needing action is cancelled and pauses', async () => {
    intentsCreate.mockResolvedValue({ id: 'pi_2', status: 'requires_action' });
    const { maybeAutoTopUp } = await load();
    expect(await maybeAutoTopUp(fake as never, 't1', NOW)).toEqual({ result: 'failed', reason: 'needs_authentication' });
    expect(intentsCancel).toHaveBeenCalledWith('pi_2');
    expect(addPackCalls).toHaveLength(0);
  });

  it('a network error leaves the charge pending (not paused) for the reconcile pass', async () => {
    intentsCreate.mockRejectedValue(new Error('socket hang up'));
    const { maybeAutoTopUp } = await load();
    expect(await maybeAutoTopUp(fake as never, 't1', NOW)).toEqual({ result: 'failed', reason: 'unknown' });
    expect(charges[0]).toMatchObject({ status: 'pending' });
    expect(settings!.paused_reason).toBeNull();
  });

  it('the same payment credited twice adds the texts once (no second receipt)', async () => {
    addPackResults = [false]; // add_text_pack says: already credited
    const { maybeAutoTopUp } = await load();
    await maybeAutoTopUp(fake as never, 't1', NOW);
    expect(sendOwnerEmail).not.toHaveBeenCalled();
    expect(releaseWaitingForTenant).not.toHaveBeenCalled();
  });
});

describe('sweepAutoTopUps reconcile', () => {
  beforeEach(() => {
    vi.resetModules();
    settings = defaultSettings();
    card = { id: 'pm_1', brand: 'visa', last4: '4242', customerId: 'cus_1' };
    balance = { month: '2026-11', month_used: 0, pack_balance: 0 };
    addPackCalls = [];
    addPackResults = [];
    nextId = 1;
    sendOwnerEmail.mockClear();
    intentsRetrieve.mockReset();
    intentsSearch.mockReset();
    fake = build();
  });

  it('finishes a pending charge whose payment actually succeeded, once', async () => {
    charges = [
      {
        id: 'p1', tenant_id: 't1', day_key: '2026-11-18', month: '2026-11', pack_key: 'texts_250', texts: 300,
        amount_pence: 1499, status: 'pending', stripe_payment_intent_id: 'pi_9', created_at: '2026-11-18T11:00:00.000Z',
      },
    ];
    intentsRetrieve.mockResolvedValue({ id: 'pi_9', status: 'succeeded' });
    const { sweepAutoTopUps } = await load();
    const out = await sweepAutoTopUps(NOW);
    expect(out.reconciled).toBe(1);
    expect(addPackCalls).toHaveLength(1);
    expect(charges[0]!.status).toBe('paid');
  });

  it('looks a charge up by its id when the payment id was never saved, and gives up after an hour', async () => {
    charges = [
      {
        id: 'p2', tenant_id: 't1', day_key: '2026-11-18', month: '2026-11', pack_key: 'texts_250', texts: 300,
        amount_pence: 1499, status: 'pending', stripe_payment_intent_id: null, created_at: '2026-11-18T10:00:00.000Z',
      },
    ];
    intentsSearch.mockResolvedValue({ data: [] });
    const { sweepAutoTopUps } = await load();
    await sweepAutoTopUps(NOW);
    expect(intentsSearch).toHaveBeenCalledWith(expect.objectContaining({ query: "metadata['charge_id']:'p2'" }));
    expect(charges[0]).toMatchObject({ status: 'failed', error: 'not_found' });
    expect(addPackCalls).toHaveLength(0);
  });
});
