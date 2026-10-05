import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

const TENANT = '11111111-1111-4111-8111-111111111111';
const PERIOD_END = 1_800_000_000;
const PERIOD_END_ISO = new Date(PERIOD_END * 1000).toISOString();
const NOT_OFFERED = 'That change isn’t available here. Contact us and we’ll sort it.';
const MANAGED = 'Your plan is managed by WorkWise. Contact us to make changes.';
const CHANGE_ERROR = "Couldn't change your plan. Nothing was charged. Please try again.";

const ENV: Record<string, string> = {
  STRIPE_PRICE_ROUNDS: 'price_rounds_m',
  STRIPE_PRICE_ROUNDS_YEARLY: 'price_rounds_y',
  STRIPE_PRICE_LITE: 'price_lite_m',
  STRIPE_PRICE_LITE_YEARLY: 'price_lite_y',
  STRIPE_PRICE_BOTH: 'price_both_m',
  STRIPE_PRICE_BOTH_YEARLY: 'price_both_y',
  STRIPE_COUPON_FOUNDING: 'FOUNDING50',
  STRIPE_COUPON_REFERRAL_MONTH: 'REFERRAL_MONTH',
  STRIPE_COUPON_REFERRAL_YEAR_35: 'REFERRAL_YEAR_35',
  STRIPE_COUPON_REFERRAL_YEAR_59: 'REFERRAL_YEAR_59',
};

const { stripe, getStripe, revalidatePath } = vi.hoisted(() => {
  const stripe = {
    subscriptions: { list: vi.fn(), retrieve: vi.fn(), update: vi.fn() },
    subscriptionSchedules: { create: vi.fn(), retrieve: vi.fn(), update: vi.fn(), release: vi.fn() },
    invoices: { createPreview: vi.fn(), list: vi.fn(), retrieve: vi.fn() },
    customers: { retrieve: vi.fn() },
    paymentMethods: { retrieve: vi.fn() },
    coupons: { retrieve: vi.fn() },
    billingPortal: { sessions: { create: vi.fn() } },
  };
  return { stripe, getStripe: vi.fn(() => stripe), revalidatePath: vi.fn() };
});

let tenantRow: { stripe_customer_id: string | null } | null;
let subs: { source: string; product: string }[];
let role: string;
let userId: string | null;
const savedEnv: Record<string, string | undefined> = {};

vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock('@/lib/stripe/client', () => ({
  getStripe,
  getAppUrl: () => 'http://localhost:3000',
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }),
    },
    from(table: string) {
      const api = {
        select() {
          return api;
        },
        eq() {
          return api;
        },
        order() {
          return api;
        },
        maybeSingle: async () => {
          if (table === 'tenants') return { data: tenantRow, error: null };
          if (table === 'users') return { data: userId ? { tenant_id: TENANT, role } : null, error: null };
          return { data: null, error: null };
        },
        then(onFulfilled: (value: { data: unknown; error: null }) => unknown, onRejected?: (err: unknown) => unknown) {
          const data = table === 'subscriptions' ? subs : [];
          return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected);
        },
      };
      return api;
    },
  }),
}));

import { cancelPlan, cardUpdateUrl, changePlan, getPlanSummary, previewPlanChange } from '@/lib/billing/manage';
import {
  cancelPlanAction,
  changePlanAction,
  openBillingPortal,
  openCardUpdate,
  previewPlanChangeAction,
} from '@/lib/actions/billing';

function liveSub(overrides: Record<string, unknown> = {}): Stripe.Subscription {
  return {
    id: 'sub_1',
    status: 'active',
    customer: 'cus_1',
    cancel_at_period_end: false,
    schedule: null,
    discounts: [],
    default_payment_method: {
      id: 'pm_1',
      object: 'payment_method',
      type: 'card',
      card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 },
    },
    items: {
      data: [{ id: 'si_1', quantity: 1, price: { id: 'price_rounds_m' }, current_period_end: PERIOD_END }],
    },
    pending_update: null,
    latest_invoice: null,
    ended_at: null,
    canceled_at: null,
    start_date: PERIOD_END - 2_000_000,
    ...overrides,
  } as unknown as Stripe.Subscription;
}

function resetFns(obj: object) {
  for (const value of Object.values(obj)) {
    if (typeof value === 'function' && 'mockReset' in value) (value as { mockReset: () => void }).mockReset();
    else if (value && typeof value === 'object') resetFns(value);
  }
}

function wire(sub: Stripe.Subscription = liveSub()) {
  stripe.subscriptions.list.mockResolvedValue({ data: [sub] });
  stripe.subscriptions.retrieve.mockResolvedValue(sub);
  stripe.customers.retrieve.mockResolvedValue({
    id: 'cus_1',
    balance: -1500,
    invoice_settings: { default_payment_method: null },
  });
  stripe.invoices.list.mockResolvedValue({ data: [] });
  stripe.invoices.createPreview.mockResolvedValue({
    amount_due: 3500,
    period_end: PERIOD_END,
    next_payment_attempt: null,
  });
  return sub;
}

function bothSub(overrides: Record<string, unknown> = {}) {
  return liveSub({
    items: { data: [{ id: 'si_1', quantity: 1, price: { id: 'price_both_m' }, current_period_end: PERIOD_END }] },
    ...overrides,
  });
}

beforeEach(() => {
  for (const [key, value] of Object.entries(ENV)) {
    if (!(key in savedEnv)) savedEnv[key] = process.env[key];
    process.env[key] = value;
  }
  delete process.env.STRIPE_PORTAL_CONFIGURATION_ID;
  tenantRow = { stripe_customer_id: 'cus_1' };
  subs = [{ source: 'stripe', product: 'rounds' }];
  role = 'admin';
  userId = 'user_1';
  getStripe.mockClear();
  revalidatePath.mockClear();
  resetFns(stripe);
  wire();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
});

describe('getPlanSummary', () => {
  it('reads the plan, next bill, card and credit from Stripe', async () => {
    const summary = await getPlanSummary(TENANT);
    expect(summary).toMatchObject({
      kind: 'stripe',
      subscriptionId: 'sub_1',
      choice: { plan: 'rounds', interval: 'month' },
      status: 'active',
      priceLabel: '£35 a month',
      currentPeriodEnd: PERIOD_END_ISO,
      cancelAtPeriodEnd: false,
      nextBill: { date: PERIOD_END_ISO, amountPence: 3500 },
      discount: null,
      creditPence: 1500,
      pendingChange: null,
      card: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 },
      invoices: [],
    });
  });

  it('labels founding, referral and other coupons', async () => {
    const foundingEnd = Math.floor(Date.UTC(2026, 10, 14) / 1000);
    wire(
      liveSub({
        discounts: [{ id: 'di_f', end: foundingEnd, source: { type: 'coupon', coupon: 'FOUNDING50' } }],
      })
    );
    const founding = await getPlanSummary(TENANT);
    expect(founding).toMatchObject({
      kind: 'stripe',
      discount: {
        label: 'Founding offer: half price until 14 Nov',
        endsAt: new Date(foundingEnd * 1000).toISOString(),
      },
    });

    wire(liveSub({ discounts: [{ id: 'di_m', end: null, source: { type: 'coupon', coupon: 'REFERRAL_MONTH' } }] }));
    expect(await getPlanSummary(TENANT)).toMatchObject({ kind: 'stripe', discount: { label: 'First month free', endsAt: null } });

    wire(liveSub({ discounts: [{ id: 'di_35', end: null, source: { type: 'coupon', coupon: 'REFERRAL_YEAR_35' } }] }));
    expect(await getPlanSummary(TENANT)).toMatchObject({ kind: 'stripe', discount: { label: '£35 off your first year', endsAt: null } });

    wire(liveSub({ discounts: [{ id: 'di_59', end: null, source: { type: 'coupon', coupon: 'REFERRAL_YEAR_59' } }] }));
    expect(await getPlanSummary(TENANT)).toMatchObject({ kind: 'stripe', discount: { label: '£59 off your first year', endsAt: null } });

    wire(
      liveSub({
        discounts: [{ id: 'di_x', end: null, source: { type: 'coupon', coupon: { id: 'SAVE10', name: 'Spring sale' } } }],
      })
    );
    expect(await getPlanSummary(TENANT)).toMatchObject({ kind: 'stripe', discount: { label: 'Spring sale', endsAt: null } });
  });

  it('uses the customer card when the subscription has none, and skips the next bill while cancelling', async () => {
    wire(liveSub({ default_payment_method: null, cancel_at_period_end: true }));
    stripe.customers.retrieve.mockResolvedValue({
      id: 'cus_1',
      balance: 400,
      invoice_settings: {
        default_payment_method: {
          id: 'pm_2',
          type: 'card',
          card: { brand: 'mastercard', last4: '4444', exp_month: 1, exp_year: 2028 },
        },
      },
    });
    const summary = await getPlanSummary(TENANT);
    expect(summary).toMatchObject({
      kind: 'stripe',
      nextBill: null,
      creditPence: 0,
      card: { brand: 'mastercard', last4: '4444', expMonth: 1, expYear: 2028 },
      cancelAtPeriodEnd: true,
    });
    expect(stripe.invoices.createPreview).not.toHaveBeenCalled();
  });

  it('returns invoices newest first and an empty list when Stripe cannot list them', async () => {
    stripe.invoices.list.mockResolvedValue({
      data: [
        { id: 'in_old', created: 100, total: 3500, status: 'paid', invoice_pdf: 'https://pdf', hosted_invoice_url: 'https://host' },
        { id: 'in_new', created: 200, total: 5900, status: 'open', invoice_pdf: null, hosted_invoice_url: null },
        { id: 'in_bad', created: 300, total: 1, status: 'deleted' },
      ],
    });
    const listed = await getPlanSummary(TENANT);
    expect(listed).toMatchObject({
      kind: 'stripe',
      invoices: [
        { id: 'in_new', amountPence: 5900, status: 'open', pdfUrl: null, hostedUrl: null },
        { id: 'in_old', amountPence: 3500, status: 'paid', pdfUrl: 'https://pdf', hostedUrl: 'https://host' },
      ],
    });

    stripe.invoices.list.mockRejectedValue(Object.assign(new Error('down'), { name: 'StripeAPIError' }));
    const failed = await getPlanSummary(TENANT);
    expect(failed).toMatchObject({ kind: 'stripe', choice: { plan: 'rounds', interval: 'month' }, invoices: [] });
    expect(console.error).toHaveBeenCalledWith('[billing] invoices.list', 'StripeAPIError');
  });

  it('reports a pending schedule phase, several live subscriptions, an unknown price, and an ended plan', async () => {
    wire(
      liveSub({
        schedule: {
          id: 'sched_1',
          status: 'active',
          current_phase: { start_date: PERIOD_END - 1000, end_date: PERIOD_END },
          phases: [
            { start_date: PERIOD_END - 1000, items: [{ price: 'price_rounds_m' }], discounts: [] },
            { start_date: PERIOD_END, items: [{ price: 'price_rounds_y' }], discounts: [] },
          ],
        },
      })
    );
    expect(await getPlanSummary(TENANT)).toMatchObject({
      kind: 'stripe',
      pendingChange: { choice: { plan: 'rounds', interval: 'year' }, effectiveDate: PERIOD_END_ISO },
    });

    stripe.subscriptions.list.mockResolvedValue({ data: [liveSub(), liveSub({ id: 'sub_2' })] });
    expect(await getPlanSummary(TENANT)).toEqual({ kind: 'contact_us', reason: 'multiple_subscriptions' });

    wire(liveSub({ items: { data: [{ id: 'si_1', price: { id: 'price_nope' }, current_period_end: PERIOD_END }] } }));
    expect(await getPlanSummary(TENANT)).toEqual({ kind: 'contact_us', reason: 'unknown_price' });

    stripe.subscriptions.list.mockResolvedValue({
      data: [liveSub({ status: 'canceled', ended_at: PERIOD_END, canceled_at: PERIOD_END })],
    });
    expect(await getPlanSummary(TENANT)).toEqual({
      kind: 'ended',
      lastChoice: { plan: 'rounds', interval: 'month' },
      endedAt: PERIOD_END_ISO,
    });
  });

  it('does not report the plan as ended when Stripe cannot list subscriptions', async () => {
    stripe.subscriptions.list.mockRejectedValue(Object.assign(new Error('net'), { name: 'StripeConnectionError' }));
    await expect(getPlanSummary(TENANT)).rejects.toThrow('net');
    expect(console.error).toHaveBeenCalledWith('[billing] subscriptions.list', 'StripeConnectionError');
    const result = await changePlan(TENANT, { plan: 'both', interval: 'month' }, 2400, 'n');
    expect(result).toEqual({ ok: false, error: CHANGE_ERROR });
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it('hides Stripe from anyone who is not an admin of this business', async () => {
    role = 'worker';
    expect(await getPlanSummary(TENANT)).toEqual({ kind: 'managed' });
    expect(getStripe).not.toHaveBeenCalled();
  });

  it('never calls Stripe for a manual row, a Pro tier, or a business with no Stripe customer', async () => {
    subs = [{ source: 'manual', product: 'rounds' }];
    expect(await getPlanSummary(TENANT)).toEqual({ kind: 'managed' });

    subs = [{ source: 'stripe', product: 'starter' }];
    expect(await getPlanSummary(TENANT)).toEqual({ kind: 'managed' });

    subs = [{ source: 'stripe', product: 'rounds' }];
    tenantRow = { stripe_customer_id: null };
    expect(await getPlanSummary(TENANT)).toEqual({ kind: 'managed' });

    await expect(changePlan(TENANT, { plan: 'both', interval: 'month' }, 0, 'n')).resolves.toEqual({
      ok: false,
      error: MANAGED,
    });
    await expect(cardUpdateUrl(TENANT)).rejects.toThrow(MANAGED);
    expect(getStripe).not.toHaveBeenCalled();
  });
});

describe('plan changes', () => {
  it('charges an upgrade now only if payment can be taken, with one idempotency key', async () => {
    wire();
    stripe.invoices.createPreview.mockResolvedValue({ amount_due: 2400, period_end: PERIOD_END, next_payment_attempt: null });
    stripe.subscriptions.update.mockResolvedValue(liveSub({ pending_update: null }));

    const result = await changePlan(TENANT, { plan: 'both', interval: 'month' }, 2400, 'nonce-1');
    expect(result).toEqual({ ok: true, applied: 'now' });
    expect(stripe.subscriptionSchedules.release).not.toHaveBeenCalled();
    expect(stripe.subscriptions.update).toHaveBeenCalledWith(
      'sub_1',
      {
        items: [{ id: 'si_1', price: 'price_both_m' }],
        proration_behavior: 'always_invoice',
        payment_behavior: 'pending_if_incomplete',
        expand: ['latest_invoice'],
      },
      { idempotencyKey: 'plan-change-nonce-1' }
    );

    await changePlan(TENANT, { plan: 'both', interval: 'month' }, 2400, 'nonce-1');
    const keys = stripe.subscriptions.update.mock.calls.map((call) => call[2]);
    expect(keys).toEqual([{ idempotencyKey: 'plan-change-nonce-1' }, { idempotencyKey: 'plan-change-nonce-1' }]);
  });

  it('refuses an upgrade while a downgrade is waiting and leaves that schedule in place', async () => {
    wire(
      liveSub({
        schedule: {
          id: 'sched_1',
          status: 'active',
          phases: [{ start_date: 1, discounts: [], items: [] }],
          current_phase: { start_date: 1, end_date: PERIOD_END },
        },
      })
    );
    const result = await changePlan(TENANT, { plan: 'both', interval: 'month' }, 2400, 'nonce-up');
    expect(result).toEqual({ ok: false, error: "Cancel the change that's waiting, then you can upgrade." });
    expect(stripe.subscriptionSchedules.release).not.toHaveBeenCalled();
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it('returns the invoice page when the bank has to confirm and the plan has not changed', async () => {
    stripe.invoices.createPreview.mockResolvedValue({ amount_due: 2400, period_end: PERIOD_END, next_payment_attempt: null });
    stripe.subscriptions.update.mockResolvedValue(
      liveSub({
        pending_update: { expires_at: PERIOD_END },
        latest_invoice: { hosted_invoice_url: 'https://pay.stripe.com/inv' },
      })
    );
    const result = await changePlan(TENANT, { plan: 'both', interval: 'month' }, 2400, 'nonce-2');
    expect(result).toEqual({ ok: true, needsAction: { hostedInvoiceUrl: 'https://pay.stripe.com/inv' } });
  });

  it('refuses when the price moved by more than 1p and still applies a 1p difference', async () => {
    stripe.invoices.createPreview.mockResolvedValue({ amount_due: 2500, period_end: PERIOD_END, next_payment_attempt: null });
    const refused = await changePlan(TENANT, { plan: 'both', interval: 'month' }, 2400, 'nonce-3');
    expect(refused).toMatchObject({
      ok: false,
      error: 'The amount has changed. Please check it and confirm again.',
      preview: { ok: true, kind: 'up_now', todayPence: 2500 },
    });
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();

    stripe.invoices.createPreview.mockResolvedValue({ amount_due: 2401, period_end: PERIOD_END, next_payment_attempt: null });
    stripe.subscriptions.update.mockResolvedValue(liveSub({ pending_update: null }));
    const allowed = await changePlan(TENANT, { plan: 'both', interval: 'month' }, 2400, 'nonce-4');
    expect(allowed).toEqual({ ok: true, applied: 'now' });
  });

  it('schedules a downgrade at renewal, releases at the end, and carries a founding discount that outlasts this period', async () => {
    const foundingEnd = PERIOD_END + 86_400;
    wire(
      bothSub({
        schedule: null,
        discounts: [
          { id: 'di_founding', end: foundingEnd, source: { type: 'coupon', coupon: 'FOUNDING50' } },
          { id: 'di_once', end: null, source: { type: 'coupon', coupon: 'REFERRAL_MONTH' } },
          { id: 'di_old', end: PERIOD_END - 10, source: { type: 'coupon', coupon: 'OLD' } },
        ],
      })
    );
    const created = {
      id: 'sched_new',
      status: 'active',
      current_phase: { start_date: 1_700_000_000, end_date: PERIOD_END },
      phases: [
        {
          start_date: 1_700_000_000,
          end_date: PERIOD_END,
          items: [{ price: 'price_both_m' }],
          discounts: [
            {
              coupon: 'FOUNDING50',
              discount: { id: 'di_founding', end: foundingEnd },
              promotion_code: null,
            },
          ],
        },
      ],
    };
    stripe.subscriptionSchedules.create.mockResolvedValue(created);
    stripe.subscriptionSchedules.update.mockResolvedValue(created);

    const result = await changePlan(TENANT, { plan: 'rounds', interval: 'month' }, 0, 'nonce-down');
    expect(result).toEqual({ ok: true, applied: 'at_renewal' });
    expect(stripe.subscriptionSchedules.create).toHaveBeenCalledWith({ from_subscription: 'sub_1' });
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();

    const [scheduleId, params, options] = stripe.subscriptionSchedules.update.mock.calls[0];
    expect(scheduleId).toBe('sched_new');
    expect(options).toEqual({ idempotencyKey: 'plan-change-nonce-down' });
    expect(params).toMatchObject({
      end_behavior: 'release',
      proration_behavior: 'none',
      phases: [
        {
          items: [{ price: 'price_both_m', quantity: 1 }],
          start_date: 1_700_000_000,
          end_date: PERIOD_END,
          discounts: [{ discount: 'di_founding' }],
          proration_behavior: 'none',
        },
        {
          items: [{ price: 'price_rounds_m', quantity: 1 }],
          duration: { interval: 'month', interval_count: 1 },
          discounts: [{ discount: 'di_founding' }],
          proration_behavior: 'none',
        },
      ],
    });
    expect(JSON.stringify(params.phases[1])).not.toContain('di_old');
    expect(JSON.stringify(params.phases[1])).not.toContain('di_once');
    expect(JSON.stringify(params.phases[0])).not.toContain('FOUNDING50');
  });

  it('replaces a pending downgrade by updating the schedule that is already there', async () => {
    const schedule = {
      id: 'sched_old',
      status: 'active',
      current_phase: { start_date: 1_700_000_000, end_date: PERIOD_END },
      phases: [{ start_date: 1_700_000_000, discounts: [], items: [{ price: 'price_both_m' }] }],
    };
    wire(bothSub({ schedule }));
    stripe.subscriptionSchedules.update.mockResolvedValue(schedule);

    const result = await changePlan(TENANT, { plan: 'rounds', interval: 'month' }, 0, 'nonce-replace');
    expect(result).toEqual({ ok: true, applied: 'at_renewal' });
    expect(stripe.subscriptionSchedules.create).not.toHaveBeenCalled();
    expect(stripe.subscriptionSchedules.update).toHaveBeenCalledWith('sched_old', expect.any(Object), {
      idempotencyKey: 'plan-change-nonce-replace',
    });
  });

  it('blocks changes while a cancellation is pending, while past due, and when the move is not offered', async () => {
    wire(liveSub({ cancel_at_period_end: true }));
    expect(await changePlan(TENANT, { plan: 'both', interval: 'month' }, 2400, 'n')).toEqual({
      ok: false,
      error: 'Undo your cancellation first.',
    });
    expect(stripe.invoices.createPreview).not.toHaveBeenCalled();

    wire(liveSub({ status: 'past_due' }));
    expect(await previewPlanChange(TENANT, { plan: 'both', interval: 'month' })).toEqual({
      ok: false,
      error: 'Update your card first, then you can change your plan.',
    });

    wire();
    expect(await previewPlanChange(TENANT, { plan: 'lite', interval: 'month' })).toEqual({ ok: false, error: NOT_OFFERED });
    expect(await previewPlanChange(TENANT, { plan: 'rounds', interval: 'month' })).toEqual({ ok: false, error: NOT_OFFERED });

    wire(bothSub());
    const preview = await previewPlanChange(TENANT, { plan: 'rounds', interval: 'month' });
    expect(preview).toEqual({
      ok: true,
      kind: 'down_at_renewal',
      target: { plan: 'rounds', interval: 'month' },
      todayPence: 0,
      thenLabel: '£35 a month',
      effectiveDate: PERIOD_END_ISO,
    });
  });

  it('will not switch to yearly while a discount is still on the subscription', async () => {
    const yearly = { plan: 'rounds', interval: 'year' } as const;
    const founding = { id: 'di_f', end: Math.floor(Date.now() / 1000) + 86_400, source: { type: 'coupon', coupon: 'FOUNDING50' } };
    wire(liveSub({ discounts: [founding] }));
    const expected = { ok: false, error: 'You can switch to yearly once your current offer has finished.' };
    expect(await previewPlanChange(TENANT, yearly)).toEqual(expected);
    expect(await changePlan(TENANT, yearly, 0, 'n')).toEqual(expected);
    expect(stripe.invoices.createPreview).not.toHaveBeenCalled();
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();

    // an unexpanded discount id fails closed; one that has ended does not block
    wire(liveSub({ discounts: ['di_unknown'] }));
    expect(await previewPlanChange(TENANT, yearly)).toEqual(expected);
    stripe.invoices.createPreview.mockResolvedValue({ amount_due: 31500, period_end: PERIOD_END, next_payment_attempt: null });
    wire(liveSub({ discounts: [{ ...founding, end: Math.floor(Date.now() / 1000) - 10 }] }));
    stripe.invoices.createPreview.mockResolvedValue({ amount_due: 31500, period_end: PERIOD_END, next_payment_attempt: null });
    expect(await previewPlanChange(TENANT, yearly)).toMatchObject({ ok: true, kind: 'up_now' });

    // no discount: allowed; and adding Lite at the same interval is not blocked by a discount
    wire(liveSub({ discounts: [founding] }));
    stripe.invoices.createPreview.mockResolvedValue({ amount_due: 1200, period_end: PERIOD_END, next_payment_attempt: null });
    expect(await previewPlanChange(TENANT, { plan: 'both', interval: 'month' })).toMatchObject({ ok: true, kind: 'up_now' });
  });

  it('says when a monthly to yearly switch next renews, from the period Stripe will charge', async () => {
    const yearEnd = PERIOD_END + 300 * 86_400;
    wire();
    stripe.invoices.createPreview.mockResolvedValue({
      amount_due: 25678,
      period_end: PERIOD_END,
      next_payment_attempt: null,
      lines: { data: [{ amount: -3319, period: { end: PERIOD_END } }, { amount: 28997, period: { end: yearEnd } }] },
    });
    expect(await previewPlanChange(TENANT, { plan: 'rounds', interval: 'year' })).toMatchObject({
      ok: true,
      kind: 'up_now',
      todayPence: 25678,
      renewsOn: new Date(yearEnd * 1000).toISOString(),
    });
    // same interval (adding Lite): the next bill is the current period end
    stripe.invoices.createPreview.mockResolvedValue({ amount_due: 1200, period_end: PERIOD_END, next_payment_attempt: null });
    expect(await previewPlanChange(TENANT, { plan: 'both', interval: 'month' })).toMatchObject({ renewsOn: PERIOD_END_ISO });
  });

  it('returns the safe error when Stripe rejects the update, and charges nothing', async () => {
    stripe.invoices.createPreview.mockResolvedValue({ amount_due: 2400, period_end: PERIOD_END, next_payment_attempt: null });
    stripe.subscriptions.update.mockRejectedValue(Object.assign(new Error('nope'), { name: 'StripeCardError' }));
    const result = await changePlan(TENANT, { plan: 'both', interval: 'month' }, 2400, 'nonce-err');
    expect(result).toEqual({ ok: false, error: CHANGE_ERROR });
    expect(console.error).toHaveBeenCalledWith('[billing] changePlan', 'StripeCardError');
  });
});

describe('cancel and card', () => {
  it('releases a pending schedule before cancelling at the period end', async () => {
    const order: string[] = [];
    wire(
      liveSub({
        schedule: {
          id: 'sched_1',
          status: 'active',
          phases: [{ start_date: 1, discounts: [], items: [] }],
          current_phase: { start_date: 1, end_date: PERIOD_END },
        },
      })
    );
    stripe.subscriptionSchedules.release.mockImplementation(async () => {
      order.push('release');
      return {};
    });
    stripe.subscriptions.update.mockImplementation(async () => {
      order.push('update');
      return liveSub({ cancel_at_period_end: true });
    });

    const result = await cancelPlan(TENANT);
    expect(result).toEqual({ ok: true, endsOn: PERIOD_END_ISO });
    expect(order).toEqual(['release', 'update']);
    expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_1', { cancel_at_period_end: true });
  });

  it('opens the portal at the card form and passes the configuration only when it is set', async () => {
    stripe.billingPortal.sessions.create.mockResolvedValue({ url: 'https://billing.stripe.com/p/session' });
    await expect(cardUpdateUrl(TENANT)).resolves.toBe('https://billing.stripe.com/p/session');
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_1',
      return_url: 'http://localhost:3000/settings?tab=billing',
      flow_data: { type: 'payment_method_update' },
    });

    process.env.STRIPE_PORTAL_CONFIGURATION_ID = 'bpc_123';
    await cardUpdateUrl(TENANT);
    expect(stripe.billingPortal.sessions.create).toHaveBeenLastCalledWith({
      customer: 'cus_1',
      return_url: 'http://localhost:3000/settings?tab=billing',
      flow_data: { type: 'payment_method_update' },
      configuration: 'bpc_123',
    });
  });
});

describe('server actions', () => {
  it('refuses anyone who is not the account owner, and does not call Stripe', async () => {
    role = 'worker';
    const result = await changePlanAction({ plan: 'both', interval: 'month' }, 2400, 'n');
    expect(result).toEqual({ ok: false, error: 'Only the account owner can change the plan.' });
    expect(getStripe).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('rejects an unknown target, refreshes settings after a cancel, and keeps the old portal name working', async () => {
    const bad = await previewPlanChangeAction({ plan: 'pro', interval: 'month' });
    expect(bad).toEqual({ ok: false, error: NOT_OFFERED });
    expect(revalidatePath).not.toHaveBeenCalled();

    stripe.subscriptions.update.mockResolvedValue(liveSub({ cancel_at_period_end: true }));
    const cancelled = await cancelPlanAction();
    expect(cancelled).toMatchObject({ ok: true, endsOn: PERIOD_END_ISO });
    expect(revalidatePath).toHaveBeenCalledWith('/settings');

    stripe.billingPortal.sessions.create.mockResolvedValue({ url: 'https://billing.stripe.com/p/session' });
    await expect(openCardUpdate()).rejects.toThrow('REDIRECT https://billing.stripe.com/p/session');
    await expect(openBillingPortal()).rejects.toThrow('REDIRECT https://billing.stripe.com/p/session');

    subs = [{ source: 'manual', product: 'rounds' }];
    revalidatePath.mockClear();
    getStripe.mockClear();
    const managed = await openBillingPortal();
    expect(managed).toEqual({ success: false, error: MANAGED });
    expect(getStripe).not.toHaveBeenCalled();
  });
});
