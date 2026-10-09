import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

const REFERRER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REFERRED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REFERRAL = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const ENV: Record<string, string> = {
  STRIPE_PRICE_ROUNDS: 'price_rounds_m',
  STRIPE_PRICE_ROUNDS_YEARLY: 'price_rounds_y',
  STRIPE_PRICE_LITE: 'price_lite_m',
  STRIPE_PRICE_LITE_YEARLY: 'price_lite_y',
  STRIPE_PRICE_BOTH: 'price_both_m',
  STRIPE_PRICE_BOTH_YEARLY: 'price_both_y',
  STRIPE_PRICE_STARTER: 'price_starter_m',
  STRIPE_PRICE_STARTER_YEARLY: 'price_starter_y',
  STRIPE_PRICE_GROWTH: 'price_growth_m',
  STRIPE_PRICE_GROWTH_YEARLY: 'price_growth_y',
  STRIPE_PRICE_PRO: 'price_pro_m',
  STRIPE_PRICE_PRO_YEARLY: 'price_pro_y',
  STRIPE_PRICE_EXTRA_WORKER_STARTER: 'price_extra_starter_m',
};

type Row = Record<string, unknown>;
type Filter =
  | { op: 'eq'; col: string; val: unknown }
  | { op: 'in'; col: string; val: unknown[] }
  | { op: 'is'; col: string; val: unknown }
  | { op: 'lt'; col: string; val: string };

const db = {
  tenants: [] as Row[],
  referrals: [] as Row[],
  subscriptions: [] as Row[],
};
let failFinish = false;
let paidInvoices: Stripe.Invoice[] = [];
let listError = false;
let missFinish = false;

type StoredTxn = { id: string; metadata?: { referral_id?: string } };
const txns = new Map<string, StoredTxn>();
const byCustomer = new Map<string, StoredTxn[]>();
let txnCount = 0;

const { stripe, getStripe } = vi.hoisted(() => {
  const stripe = {
    customers: { createBalanceTransaction: vi.fn(), listBalanceTransactions: vi.fn() },
    invoices: { list: vi.fn() },
  };
  return { stripe, getStripe: vi.fn(() => stripe) };
});

vi.mock('@/lib/stripe/client', () => ({ getStripe }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: (table: string) => query(table) }),
}));

import {
  invoiceQualifies,
  listMyReferrals,
  onInvoicePaid,
  onSubscriptionEnded,
  paidValuePence,
  sweepStuckReferralRewards,
} from '@/lib/billing/referrals';

function query(table: string) {
  const state: {
    op: 'select' | 'update';
    patch: Row | null;
    filters: Filter[];
    or: string | null;
    order: { col: string; asc: boolean } | null;
    limit: number | null;
  } = { op: 'select', patch: null, filters: [], or: null, order: null, limit: null };

  const run = (one: boolean) => {
    const tableRows = db[table as keyof typeof db];
    if (state.op === 'update' && state.patch?.status === 'rewarded' && failFinish) {
      return { data: one ? null : null, error: { message: 'finish failed' } };
    }
    if (state.op === 'update' && state.patch?.status === 'rewarded' && missFinish) {
      return { data: one ? null : [], error: null };
    }
    let rows = tableRows.filter((row) => matches(row, state));
    if (state.op === 'update' && state.patch) {
      for (const row of rows) Object.assign(row, state.patch);
    }
    if (state.order) {
      const { col, asc } = state.order;
      rows = [...rows].sort((a, b) => {
        const left = String(a[col] ?? '');
        const right = String(b[col] ?? '');
        return asc ? left.localeCompare(right) : right.localeCompare(left);
      });
    }
    if (state.limit != null) rows = rows.slice(0, state.limit);
    if (one) return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  };

  const api = {
    select() {
      return api;
    },
    update(patch: Row) {
      state.op = 'update';
      state.patch = patch;
      return api;
    },
    eq(col: string, val: unknown) {
      state.filters.push({ op: 'eq', col, val });
      return api;
    },
    in(col: string, val: unknown[]) {
      state.filters.push({ op: 'in', col, val });
      return api;
    },
    is(col: string, val: unknown) {
      state.filters.push({ op: 'is', col, val });
      return api;
    },
    lt(col: string, val: string) {
      state.filters.push({ op: 'lt', col, val });
      return api;
    },
    or(raw: string) {
      state.or = raw;
      return api;
    },
    order(col: string, opts?: { ascending?: boolean }) {
      state.order = { col, asc: opts?.ascending !== false };
      return api;
    },
    limit(n: number) {
      state.limit = n;
      return api;
    },
    maybeSingle: async () => run(true),
    then(onFulfilled: (value: { data: unknown; error: unknown }) => unknown, onRejected?: (err: unknown) => unknown) {
      return Promise.resolve(run(false)).then(onFulfilled, onRejected);
    },
  };
  return api;
}

function matches(row: Row, state: { filters: Filter[]; or: string | null }): boolean {
  for (const filter of state.filters) {
    if (filter.op === 'eq' && row[filter.col] !== filter.val) return false;
    if (filter.op === 'in' && !filter.val.includes(row[filter.col])) return false;
    if (filter.op === 'is' && filter.val === null && row[filter.col] != null) return false;
    if (filter.op === 'lt') {
      const left = row[filter.col];
      if (typeof left !== 'string' || left >= filter.val) return false;
    }
  }
  if (state.or && !matchOr(row, state.or)) return false;
  return true;
}

function matchOr(row: Row, raw: string): boolean {
  return splitTop(raw).some((part) => matchClause(row, part));
}

function matchClause(row: Row, clause: string): boolean {
  if (clause.startsWith('and(') && clause.endsWith(')')) {
    return splitTop(clause.slice(4, -1)).every((part) => matchClause(row, part));
  }
  const quoted = clause.match(/^([a-z_]+)\.(eq|lt)\."(.*)"$/);
  const plain = clause.match(/^([a-z_]+)\.(eq|lt)\.(.*)$/);
  const found = quoted ?? plain;
  if (!found) return false;
  const [, col, op, val] = found;
  if (op === 'eq') return row[col] === val;
  return typeof row[col] === 'string' && (row[col] as string) < val;
}

function splitTop(raw: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let quote = false;
  for (const ch of raw) {
    if (ch === '"') quote = !quote;
    else if (!quote && ch === '(') depth += 1;
    else if (!quote && ch === ')') depth -= 1;
    else if (!quote && depth === 0 && ch === ',') {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

function seed(plan: 'rounds' | 'lite' | 'both' | null, status = 'active') {
  db.tenants = [
    { id: REFERRER, name: 'A', stripe_customer_id: 'cus_referrer', closed_at: null },
    { id: REFERRED, name: 'B', stripe_customer_id: 'cus_referred', closed_at: null },
  ];
  db.subscriptions = plan
    ? [{ tenant_id: REFERRER, source: 'stripe', product: plan === 'both' ? 'rounds' : plan, status, plan }]
    : [];
  db.referrals = [
    {
      id: REFERRAL,
      referrer_tenant_id: REFERRER,
      referred_tenant_id: REFERRED,
      status: 'waiting',
      reward_pence: null,
      claimed_at: null,
      qualifying_invoice_id: null,
      stripe_balance_transaction_id: null,
      rewarded_at: null,
      void_reason: null,
      created_at: '2026-01-02T00:00:00.000Z',
    },
  ];
}

function referral() {
  return db.referrals[0]!;
}

function invoice(opts: {
  id?: string;
  subtotal: number;
  discount?: number;
  price: string;
  status?: Stripe.Invoice.Status;
}): Stripe.Invoice {
  return {
    id: opts.id ?? 'in_1',
    status: opts.status ?? 'paid',
    customer: 'cus_referred',
    subtotal: opts.subtotal,
    total_discount_amounts: opts.discount ? [{ amount: opts.discount }] : null,
    lines: {
      data: [
        {
          amount: opts.subtotal,
          subscription: 'sub_1',
          parent: { type: 'subscription_item_details' },
          pricing: { type: 'price_details', price_details: { price: opts.price } },
        },
      ],
    },
  } as unknown as Stripe.Invoice;
}

beforeEach(() => {
  failFinish = false;
  missFinish = false;
  txnCount = 0;
  txns.clear();
  byCustomer.clear();
  db.tenants = [];
  db.referrals = [];
  db.subscriptions = [];
  for (const [key, value] of Object.entries(ENV)) process.env[key] = value;
  stripe.customers.createBalanceTransaction.mockReset();
  stripe.customers.createBalanceTransaction.mockImplementation(
    async (customerId: string, params: { metadata?: { referral_id?: string } }, options?: { idempotencyKey?: string }) => {
      const key = options?.idempotencyKey ?? '';
      const existing = txns.get(key);
      if (existing) return existing;
      const txn = { id: `txn_${++txnCount}`, metadata: params.metadata };
      txns.set(key, txn);
      const list = byCustomer.get(customerId) ?? [];
      list.push(txn);
      byCustomer.set(customerId, list);
      return txn;
    }
  );
  paidInvoices = [];
  listError = false;
  stripe.invoices.list.mockReset();
  stripe.invoices.list.mockImplementation(async () => {
    if (listError) throw Object.assign(new Error('down'), { name: 'StripeConnectionError' });
    return { data: paidInvoices, has_more: false };
  });
  stripe.customers.listBalanceTransactions.mockReset();
  stripe.customers.listBalanceTransactions.mockImplementation(
    async (customerId: string, params?: { limit?: number; starting_after?: string }) => {
      const all = byCustomer.get(customerId) ?? [];
      const limit = params?.limit ?? 100;
      const found = params?.starting_after ? all.findIndex((txn) => txn.id === params.starting_after) : -1;
      const start = params?.starting_after ? (found >= 0 ? found + 1 : all.length) : 0;
      const data = all.slice(start, start + limit);
      return { data, has_more: start + data.length < all.length };
    }
  );
});

describe('paidValuePence', () => {
  it('subtracts coupon discounts and ignores a missing discount list', () => {
    expect(paidValuePence({ subtotal: 3500, total_discount_amounts: [{ amount: 1750, discount: 'd' }] })).toBe(1750);
    expect(paidValuePence({ subtotal: 3500, total_discount_amounts: null })).toBe(3500);
    expect(invoiceQualifies(invoice({ subtotal: 0, price: 'price_rounds_m', status: 'open' }), 'rounds')).toBe(false);
  });
});

describe('onInvoicePaid', () => {
  it('holds a free-month referral until a full £35 is paid, then credits £35 once', async () => {
    seed('rounds');
    const first = await onInvoicePaid(invoice({ id: 'in_free', subtotal: 3500, discount: 3500, price: 'price_rounds_m' }));
    expect(first).toEqual({ result: 'not_yet' });
    expect(referral().status).toBe('waiting');
    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled();

    const second = await onInvoicePaid(invoice({ id: 'in_full', subtotal: 3500, price: 'price_rounds_m' }));
    expect(second).toEqual({ result: 'rewarded', referralId: REFERRAL, rewardPence: 3500 });
    expect(referral().status).toBe('rewarded');
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledTimes(1);
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledWith(
      'cus_referrer',
      expect.objectContaining({ amount: -3500, currency: 'gbp', description: 'Free month for referring B' }),
      { idempotencyKey: `referral-reward-${REFERRAL}` }
    );
  });

  it('holds founding £17.50 invoices and credits on the first full month', async () => {
    seed('rounds');
    const half = () => invoice({ subtotal: 3500, discount: 1750, price: 'price_rounds_m' });
    expect(await onInvoicePaid(half())).toEqual({ result: 'not_yet' });
    expect(await onInvoicePaid({ ...half(), id: 'in_half_2' })).toEqual({ result: 'not_yet' });
    const paid = await onInvoicePaid(invoice({ id: 'in_month_3', subtotal: 3500, price: 'price_rounds_m' }));
    expect(paid).toEqual({ result: 'rewarded', referralId: REFERRAL, rewardPence: 3500 });
  });

  it('credits a yearly referee on the first invoice because £315 is already a full month', async () => {
    seed('rounds');
    const result = await onInvoicePaid(invoice({ subtotal: 35000, discount: 3500, price: 'price_lite_y' }));
    expect(result).toEqual({ result: 'rewarded', referralId: REFERRAL, rewardPence: 3500 });
    expect(paidValuePence({ subtotal: 35000, total_discount_amounts: [{ amount: 3500, discount: 'd' }] })).toBe(31500);
  });

  it('credits £59 when the referrer is on both', async () => {
    seed('both');
    const result = await onInvoicePaid(invoice({ subtotal: 3500, price: 'price_lite_m' }));
    expect(result).toEqual({ result: 'rewarded', referralId: REFERRAL, rewardPence: 5900 });
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledWith(
      'cus_referrer',
      expect.objectContaining({ amount: -5900 }),
      expect.anything()
    );
  });

  it('voids the referral when the referrer has no live plan', async () => {
    seed('rounds', 'canceled');
    const result = await onInvoicePaid(invoice({ subtotal: 3500, price: 'price_rounds_m' }));
    expect(result).toEqual({ result: 'void', reason: 'referrer_no_live_plan' });
    expect(referral().status).toBe('void');
    expect(referral().void_reason).toBe('referrer_no_live_plan');
    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
  });

  it('does not void a reward already in progress when the referrer has since lapsed', async () => {
    seed('rounds', 'canceled');
    referral().status = 'rewarding';
    referral().reward_pence = 3500;
    referral().claimed_at = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const result = await onInvoicePaid(invoice({ subtotal: 3500, price: 'price_rounds_m' }));
    expect(result).toEqual({ result: 'already_handled' });
    expect(referral().status).toBe('rewarding');
    expect(referral().void_reason).toBeNull();
    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
  });

  it('lets one of two deliveries claim the credit', async () => {
    seed('rounds');
    const bill = invoice({ subtotal: 3500, price: 'price_rounds_m' });
    const [left, right] = await Promise.all([onInvoicePaid(bill), onInvoicePaid(bill)]);
    const results = [left.result, right.result].sort();
    expect(results).toEqual(['already_handled', 'rewarded']);
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledTimes(1);
    expect(referral().status).toBe('rewarded');
  });

  it('puts the row back to waiting and rethrows when Stripe fails', async () => {
    seed('rounds');
    stripe.customers.createBalanceTransaction.mockRejectedValueOnce(new Error('stripe down'));
    await expect(onInvoicePaid(invoice({ subtotal: 3500, price: 'price_rounds_m' }))).rejects.toThrow('stripe down');
    expect(referral().status).toBe('waiting');
    expect(referral().claimed_at).toBeNull();
  });

  it('leaves a failed finish in rewarding and the sweep completes it without a second credit', async () => {
    seed('rounds');
    failFinish = true;
    await expect(onInvoicePaid(invoice({ subtotal: 3500, price: 'price_rounds_m' }))).rejects.toThrow('finish failed');
    expect(referral().status).toBe('rewarding');
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledTimes(1);
    const firstOptions = stripe.customers.createBalanceTransaction.mock.calls[0]?.[2] as { idempotencyKey?: string } | undefined;
    expect(firstOptions?.idempotencyKey).toBe(`referral-reward-${REFERRAL}`);

    referral().claimed_at = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    failFinish = false;
    await expect(sweepStuckReferralRewards()).resolves.toEqual({ retried: 1, rewarded: 1, failed: 0 });
    expect(referral().status).toBe('rewarded');
    expect(referral().stripe_balance_transaction_id).toBe('txn_1');
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledTimes(1);
  });

  it('throws and leaves the row rewarding when the finish update matches nothing', async () => {
    seed('rounds');
    missFinish = true;
    await expect(onInvoicePaid(invoice({ subtotal: 3500, price: 'price_rounds_m' }))).rejects.toThrow(
      'Referral reward was not recorded'
    );
    expect(referral().status).toBe('rewarding');
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledTimes(1);
  });

  it('reuses the existing credit after Stripe has forgotten the idempotency key', async () => {
    seed('rounds');
    failFinish = true;
    await expect(onInvoicePaid(invoice({ subtotal: 3500, price: 'price_rounds_m' }))).rejects.toThrow('finish failed');
    txns.clear();
    referral().claimed_at = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    failFinish = false;
    await expect(sweepStuckReferralRewards()).resolves.toEqual({ retried: 1, rewarded: 1, failed: 0 });
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledTimes(1);
    expect(referral().stripe_balance_transaction_id).toBe('txn_1');
    expect(referral().status).toBe('rewarded');
  });

  it('finds that credit when it is not on the first page', async () => {
    seed('rounds');
    const filler = Array.from({ length: 100 }, (_, index) => ({ id: `old_${index}`, metadata: {} }));
    byCustomer.set('cus_referrer', [...filler, { id: 'txn_saved', metadata: { referral_id: REFERRAL } }]);
    referral().status = 'rewarding';
    referral().reward_pence = 3500;
    referral().claimed_at = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    await expect(sweepStuckReferralRewards()).resolves.toEqual({ retried: 1, rewarded: 1, failed: 0 });
    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
    expect(stripe.customers.listBalanceTransactions).toHaveBeenCalledTimes(2);
    expect(referral().stripe_balance_transaction_id).toBe('txn_saved');
  });

  it('does not count a small upgrade invoice as a full month', async () => {
    seed('rounds');
    const result = await onInvoicePaid(invoice({ subtotal: 2400, price: 'price_both_m' }));
    expect(result).toEqual({ result: 'not_yet' });
    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
  });
});

describe('onSubscriptionEnded', () => {
  it('voids a waiting referral when the new trader leaves', async () => {
    seed('rounds');
    await onSubscriptionEnded({ customer: 'cus_referred' } as Stripe.Subscription);
    expect(referral().status).toBe('void');
    expect(referral().void_reason).toBe('referee_left');
  });
});

describe('listMyReferrals', () => {
  it('returns the referred business name, newest first', async () => {
    seed('rounds');
    db.referrals.push({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      referrer_tenant_id: REFERRER,
      referred_tenant_id: REFERRED,
      status: 'rewarded',
      reward_pence: 3500,
      claimed_at: null,
      rewarded_at: '2026-02-01T00:00:00.000Z',
      created_at: '2026-03-01T00:00:00.000Z',
      void_reason: null,
    });
    const rows = await listMyReferrals(REFERRER);
    expect(rows[0]?.createdAt).toBe('2026-03-01T00:00:00.000Z');
    expect(rows[0]?.businessName).toBe('B');
    expect(rows[0]?.rewardPence).toBe(3500);
    expect(rows).toHaveLength(2);
  });
});


// ---- Pro (Phase 8 step 20) ----

type ProRow = { product: string; source?: string; status?: string; billing_interval?: string };

function seedPro(referrerRows: ProRow[], referredRows: ProRow[] = []) {
  seed(null);
  db.subscriptions = [
    ...referrerRows.map((r) => ({ tenant_id: REFERRER, source: 'stripe', status: 'active', plan: null, ...r })),
    ...referredRows.map((r) => ({ tenant_id: REFERRED, source: 'stripe', status: 'active', plan: null, ...r })),
  ];
}

function proInvoice(opts: {
  id: string;
  price: string;
  subtotal: number;
  reason?: string;
  discount?: number;
  status?: Stripe.Invoice.Status;
  extras?: number;
}): Stripe.Invoice {
  const lines = [
    {
      amount: opts.subtotal - (opts.extras ?? 0),
      subscription: 'sub_1',
      parent: { type: 'subscription_item_details' },
      pricing: { type: 'price_details', price_details: { price: opts.price } },
    },
  ];
  if (opts.extras) {
    lines.push({
      amount: opts.extras,
      subscription: 'sub_1',
      parent: { type: 'subscription_item_details' },
      pricing: { type: 'price_details', price_details: { price: 'price_extra_starter_m' } },
    });
  }
  return {
    id: opts.id,
    status: opts.status ?? 'paid',
    customer: 'cus_referred',
    billing_reason: opts.reason ?? 'subscription_cycle',
    subtotal: opts.subtotal,
    total_discount_amounts: opts.discount ? [{ amount: opts.discount }] : null,
    lines: { data: lines },
  } as unknown as Stripe.Invoice;
}

/** Pays the invoice: it is now in Stripe's paid list, then the webhook handler runs. */
async function pay(inv: Stripe.Invoice) {
  paidInvoices = [...paidInvoices, inv];
  return onInvoicePaid(inv);
}

describe('onInvoicePaid: a Pro referred business', () => {
  const growthBill = (id: string, reason = 'subscription_cycle', extra: Partial<Parameters<typeof proInvoice>[0]> = {}) =>
    proInvoice({ id, price: 'price_growth_m', subtotal: 44900, reason, ...extra });

  it('waits for the third full monthly bill, then credits once', async () => {
    seedPro([{ product: 'rounds', plan: 'rounds' } as ProRow]);
    expect(await pay(growthBill('in_1', 'subscription_create'))).toEqual({ result: 'not_yet' });
    expect(await pay(growthBill('in_2'))).toEqual({ result: 'not_yet' });
    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
    const third = await pay(growthBill('in_3'));
    expect(third).toEqual({ result: 'rewarded', referralId: REFERRAL, rewardPence: 3500 });
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledTimes(1);
    expect(referral().status).toBe('rewarded');
    expect(referral().qualifying_invoice_id).toBe('in_3');
  });

  it('a replayed third-bill event is already handled and credits nothing more', async () => {
    seedPro([{ product: 'rounds', plan: 'rounds' } as ProRow]);
    await pay(growthBill('in_1', 'subscription_create'));
    await pay(growthBill('in_2'));
    const third = growthBill('in_3');
    await pay(third);
    expect(await onInvoicePaid(third)).toEqual({ result: 'already_handled' });
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledTimes(1);
  });

  it('does not count a mid-cycle invoice (an extra worker added)', async () => {
    seedPro([{ product: 'rounds', plan: 'rounds' } as ProRow]);
    await pay(growthBill('in_1', 'subscription_create'));
    await pay(growthBill('in_up', 'subscription_update'));
    expect(await pay(growthBill('in_2'))).toEqual({ result: 'not_yet' });
    expect(referral().status).toBe('waiting');
  });

  it('does not count a bill paid below the plan price (a discount)', async () => {
    seedPro([{ product: 'rounds', plan: 'rounds' } as ProRow]);
    await pay(growthBill('in_1', 'subscription_create', { discount: 1000 }));
    await pay(growthBill('in_2'));
    expect(await pay(growthBill('in_3'))).toEqual({ result: 'not_yet' });
  });

  it('counts extras as no part of the plan price: a plan-price bill with extras still counts', async () => {
    seedPro([{ product: 'rounds', plan: 'rounds' } as ProRow]);
    await pay(growthBill('in_1', 'subscription_create'));
    await pay(growthBill('in_2'));
    const third = proInvoice({ id: 'in_3', price: 'price_growth_m', subtotal: 44900 + 1800, extras: 1800, reason: 'subscription_cycle' });
    expect((await pay(third)).result).toBe('rewarded');
  });

  it('a yearly business qualifies on its first yearly payment', async () => {
    seedPro([{ product: 'rounds', plan: 'rounds' } as ProRow]);
    const result = await pay(proInvoice({ id: 'in_y', price: 'price_starter_y', subtotal: 149000, reason: 'subscription_create' }));
    expect(result).toEqual({ result: 'rewarded', referralId: REFERRAL, rewardPence: 3500 });
  });

  it('a yearly invoice below the yearly price does not qualify', async () => {
    seedPro([{ product: 'rounds', plan: 'rounds' } as ProRow]);
    const result = await pay(proInvoice({ id: 'in_y', price: 'price_starter_y', subtotal: 149000, discount: 5000, reason: 'subscription_create' }));
    expect(result).toEqual({ result: 'not_yet' });
  });

  it('gives a Pro referrer the cheaper of the two plans', async () => {
    seedPro([{ product: 'starter', billing_interval: 'month' }]);
    const growth = await pay(proInvoice({ id: 'in_y', price: 'price_growth_y', subtotal: 449000, reason: 'subscription_create' }));
    expect(growth).toEqual({ result: 'rewarded', referralId: REFERRAL, rewardPence: 14900 });
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledWith(
      'cus_referrer',
      expect.objectContaining({ amount: -14900 }),
      { idempotencyKey: `referral-reward-${REFERRAL}` },
    );
  });

  it('a Pro referrer of a Rounds business gets £35, not £149', async () => {
    seedPro([{ product: 'starter', billing_interval: 'month' }]);
    const result = await onInvoicePaid(invoice({ subtotal: 3500, price: 'price_rounds_m' }));
    expect(result).toEqual({ result: 'rewarded', referralId: REFERRAL, rewardPence: 3500 });
  });

  it('a manual Pro business is never a referrer: the referral is voided', async () => {
    seedPro([{ product: 'pro', source: 'manual', status: 'manual' }]);
    const result = await onInvoicePaid(invoice({ subtotal: 3500, price: 'price_rounds_m' }));
    expect(result).toEqual({ result: 'void', reason: 'referrer_no_live_plan' });
    expect(referral().status).toBe('void');
    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
  });

  it('a Pro row that is not Stripe-billed also voids it', async () => {
    seedPro([{ product: 'starter' }, { product: 'pro', source: 'other' }]);
    const result = await onInvoicePaid(invoice({ subtotal: 3500, price: 'price_rounds_m' }));
    expect(result.result).toBe('void');
  });

  it('an ended Pro referrer voids it', async () => {
    seedPro([{ product: 'starter', status: 'canceled' }]);
    const result = await onInvoicePaid(invoice({ subtotal: 3500, price: 'price_rounds_m' }));
    expect(result).toEqual({ result: 'void', reason: 'referrer_no_live_plan' });
  });

  it('falls back to the referred business\'s own rows when the invoice shows no known price', async () => {
    seedPro([{ product: 'rounds', plan: 'rounds' } as ProRow], [{ product: 'starter', billing_interval: 'year' }]);
    const result = await pay(proInvoice({ id: 'in_x', price: 'price_unknown', subtotal: 149000, reason: 'subscription_create' }));
    // the invoice shows no known price, so the plan (Starter, yearly) comes from the business's own rows
    expect(result).toEqual({ result: 'rewarded', referralId: REFERRAL, rewardPence: 3500 });
  });

  it('a Stripe error on the credit returns the row to waiting and rethrows', async () => {
    seedPro([{ product: 'rounds', plan: 'rounds' } as ProRow]);
    stripe.customers.createBalanceTransaction.mockRejectedValueOnce(Object.assign(new Error('down'), { name: 'StripeAPIError' }));
    const inv = proInvoice({ id: 'in_y', price: 'price_starter_y', subtotal: 149000, reason: 'subscription_create' });
    paidInvoices = [inv];
    await expect(onInvoicePaid(inv)).rejects.toThrow('down');
    expect(referral().status).toBe('waiting');
  });

  it('a failure listing invoices rethrows and rewards nothing', async () => {
    seedPro([{ product: 'rounds', plan: 'rounds' } as ProRow]);
    listError = true;
    await expect(
      onInvoicePaid(proInvoice({ id: 'in_1', price: 'price_growth_m', subtotal: 44900, reason: 'subscription_create' })),
    ).rejects.toThrow('down');
    expect(referral().status).toBe('waiting');
    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
  });

  it('never rewards from an unpaid invoice', async () => {
    seedPro([{ product: 'rounds', plan: 'rounds' } as ProRow]);
    const result = await onInvoicePaid(proInvoice({ id: 'in_o', price: 'price_growth_m', subtotal: 44900, status: 'open' }));
    expect(result).toEqual({ result: 'no_referral' });
  });
});
