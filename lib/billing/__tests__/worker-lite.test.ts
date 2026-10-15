import { beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { method: string; args: unknown[] };
type Script = Record<string, (calls: Call[]) => { data: unknown; error?: unknown }>;

/** A stand-in for the admin client: every table answers from a script that sees the calls made on it. */
function makeAdmin(script: Script) {
  const log: Array<{ table: string; calls: Call[] }> = [];
  const from = (table: string) => {
    const calls: Call[] = [];
    log.push({ table, calls });
    const answer = () => {
      const handler = script[table];
      const result = handler ? handler(calls) : { data: null };
      return { data: result.data, error: result.error ?? null };
    };
    const proxy: Record<string, unknown> = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === 'then') return (resolve: (r: unknown) => void) => resolve(answer());
          return (...args: unknown[]) => {
            calls.push({ method: prop, args });
            if (prop === 'maybeSingle' || prop === 'single') return Promise.resolve(answer());
            return proxy;
          };
        },
      },
    );
    return proxy;
  };
  return { client: { from }, log };
}

let admin: ReturnType<typeof makeAdmin>;
const stripe = {
  customers: { create: vi.fn() },
  checkout: { sessions: { create: vi.fn() } },
};

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => admin.client }));
vi.mock('@/lib/stripe/client', () => ({ getStripe: () => stripe, getAppUrl: () => 'https://app.test' }));

import { checkWorkerLiteGate, createWorkerLiteCheckout, isWorkerBusiness } from '@/lib/billing/worker-lite';

const ids = (calls: Call[]) => calls.filter((c) => c.method === 'eq').map((c) => `${c.args[0]}=${c.args[1]}`);

/** A healthy world: a worker business linked to a live worker whose employer has a Pro plan. */
function healthy(over: Partial<Record<string, ReturnType<Script[string]>>> = {}): Script {
  return {
    tenants: (calls) => {
      const wanted = ids(calls).find((c) => c.startsWith('id='));
      if (wanted === 'id=employer') return over.employerTenant ?? { data: { name: 'Acme Locks' } };
      return over.tenant ?? { data: { closed_at: null, worker_discount_worker_id: 'w1', name: 'Sam Locks', stripe_customer_id: null } };
    },
    workers: () => over.worker ?? { data: { id: 'w1', invite_status: 'accepted', worker_type: 'company_subcontractor', primary_tenant_id: 'employer' } },
    subscriptions: (calls) => {
      const tenant = ids(calls).find((c) => c.startsWith('tenant_id='));
      if (tenant === 'tenant_id=employer') return over.employerSubs ?? { data: [{ product: 'pro', status: 'manual' }] };
      return over.ownSubs ?? { data: [] };
    },
    users: () => ({ data: { email: 'sam@example.com' } }),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  stripe.customers.create.mockReset().mockResolvedValue({ id: 'cus_new' });
  stripe.checkout.sessions.create.mockReset().mockResolvedValue({ url: 'https://checkout.test/s' });
  process.env.STRIPE_COUPON_WORKER_LITE = 'worker_lite_20';
  process.env.STRIPE_PRICE_LITE = 'price_lite_m';
  process.env.STRIPE_PRICE_LITE_YEARLY = 'price_lite_y';
});

describe('checkWorkerLiteGate', () => {
  it('lets a linked worker business with a live employer through, naming the employer', async () => {
    admin = makeAdmin(healthy());
    expect(await checkWorkerLiteGate('t1')).toEqual({ ok: true, workerId: 'w1', employerTenantId: 'employer', employerName: 'Acme Locks' });
  });

  it('refuses a business that is not a worker business, a closed one, and one with Lite already', async () => {
    admin = makeAdmin(healthy({ tenant: { data: { closed_at: null, worker_discount_worker_id: null } } }));
    expect(await checkWorkerLiteGate('t1')).toEqual({ ok: false, reason: 'not_worker_business' });

    admin = makeAdmin(healthy({ tenant: { data: { closed_at: '2026-10-01', worker_discount_worker_id: 'w1' } } }));
    expect(await checkWorkerLiteGate('t1')).toEqual({ ok: false, reason: 'closed' });

    admin = makeAdmin(healthy({ ownSubs: { data: [{ product: 'lite', status: 'active' }] } }));
    expect(await checkWorkerLiteGate('t1')).toEqual({ ok: false, reason: 'has_lite' });
  });

  it('refuses when the worker was deactivated or deleted, or the employer has no Pro plan', async () => {
    admin = makeAdmin(healthy({ worker: { data: { id: 'w1', invite_status: 'deactivated', worker_type: 'company_subcontractor', primary_tenant_id: 'employer' } } }));
    expect(await checkWorkerLiteGate('t1')).toEqual({ ok: false, reason: 'link_ended' });

    admin = makeAdmin(healthy({ worker: { data: null } }));
    expect(await checkWorkerLiteGate('t1')).toEqual({ ok: false, reason: 'link_ended' });

    admin = makeAdmin(healthy({ employerSubs: { data: [{ product: 'pro', status: 'canceled' }] } }));
    expect(await checkWorkerLiteGate('t1')).toEqual({ ok: false, reason: 'link_ended' });
  });

  it('fails closed when a read fails', async () => {
    admin = makeAdmin(healthy({ employerSubs: { data: null, error: { message: 'boom' } } }));
    expect(await checkWorkerLiteGate('t1')).toEqual({ ok: false, reason: 'unknown' });

    admin = makeAdmin(healthy({ tenant: { data: null, error: { message: 'boom' } } }));
    expect(await checkWorkerLiteGate('t1')).toEqual({ ok: false, reason: 'unknown' });
  });
});

describe('isWorkerBusiness', () => {
  it('is true only when the business has a linked worker, and false if the read fails', async () => {
    admin = makeAdmin({ tenants: () => ({ data: { worker_discount_worker_id: 'w1' } }) });
    expect(await isWorkerBusiness('t1')).toBe(true);
    admin = makeAdmin({ tenants: () => ({ data: { worker_discount_worker_id: null } }) });
    expect(await isWorkerBusiness('t1')).toBe(false);
    admin = makeAdmin({ tenants: () => ({ data: null, error: { message: 'boom' } }) });
    expect(await isWorkerBusiness('t1')).toBe(false);
  });
});

describe('createWorkerLiteCheckout', () => {
  it('opens Checkout with the worker coupon and no promotion-code box, making the customer first', async () => {
    admin = makeAdmin({
      ...healthy(),
      tenants: (calls) => {
        const eq = ids(calls);
        if (eq.includes('id=employer')) return { data: { name: 'Acme Locks' } };
        if (calls.some((c) => c.method === 'update')) return { data: [{ id: 't1' }] };
        return { data: { closed_at: null, worker_discount_worker_id: 'w1', name: 'Sam Locks', stripe_customer_id: null } };
      },
    });
    const url = await createWorkerLiteCheckout('t1', 'month', 'nonce-12345678');
    expect(url).toBe('https://checkout.test/s');

    expect(stripe.customers.create).toHaveBeenCalledWith(
      { email: 'sam@example.com', name: 'Sam Locks', metadata: { tenant_id: 't1' } },
      { idempotencyKey: 'worker-lite-customer-t1' },
    );
    const [params, options] = stripe.checkout.sessions.create.mock.calls[0];
    expect(params).toMatchObject({
      mode: 'subscription',
      customer: 'cus_new',
      line_items: [{ price: 'price_lite_m', quantity: 1 }],
      discounts: [{ coupon: 'worker_lite_20' }],
      metadata: { kind: 'worker_lite', tenant_id: 't1' },
      subscription_data: { metadata: { kind: 'worker_lite', tenant_id: 't1', plan: 'lite', interval: 'month' } },
      success_url: 'https://app.test/worker/lite-added',
      cancel_url: 'https://app.test/add-lite',
    });
    expect(params).not.toHaveProperty('allow_promotion_codes');
    expect(options).toEqual({ idempotencyKey: 'worker-lite-t1-nonce-12345678' });
  });

  it('uses the yearly Lite price for a yearly choice', async () => {
    admin = makeAdmin(healthy({ tenant: { data: { closed_at: null, worker_discount_worker_id: 'w1', name: 'Sam Locks', stripe_customer_id: 'cus_old' } } }));
    await createWorkerLiteCheckout('t1', 'year', 'nonce-12345678');
    expect(stripe.checkout.sessions.create.mock.calls[0][0].line_items[0].price).toBe('price_lite_y');
  });

  it('does not make a second Stripe customer when the business already has one', async () => {
    admin = makeAdmin(healthy({ tenant: { data: { closed_at: null, worker_discount_worker_id: 'w1', name: 'Sam Locks', stripe_customer_id: 'cus_old' } } }));
    await createWorkerLiteCheckout('t1', 'month', 'nonce-12345678');
    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(stripe.checkout.sessions.create.mock.calls[0][0].customer).toBe('cus_old');
  });

  it('uses the customer another request stored first when it loses the race', async () => {
    let reads = 0;
    admin = makeAdmin({
      ...healthy(),
      tenants: (calls) => {
        if (ids(calls).includes('id=employer')) return { data: { name: 'Acme Locks' } };
        if (calls.some((c) => c.method === 'update')) return { data: [] }; // lost: nothing updated
        reads += 1;
        // gate read, customer read (none yet), then the re-read after losing
        if (reads <= 2) return { data: { closed_at: null, worker_discount_worker_id: 'w1', name: 'Sam Locks', stripe_customer_id: null } };
        return { data: { stripe_customer_id: 'cus_winner' } };
      },
    });
    await createWorkerLiteCheckout('t1', 'month', 'nonce-12345678');
    expect(stripe.checkout.sessions.create.mock.calls[0][0].customer).toBe('cus_winner');
  });

  it('never opens Checkout when the coupon is not configured', async () => {
    delete process.env.STRIPE_COUPON_WORKER_LITE;
    admin = makeAdmin(healthy());
    await expect(createWorkerLiteCheckout('t1', 'month', 'nonce-12345678')).rejects.toThrow('missing_coupon');
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(stripe.customers.create).not.toHaveBeenCalled();
  });

  it('creates nothing in Stripe when the gate refuses', async () => {
    admin = makeAdmin(healthy({ employerSubs: { data: [] } }));
    await expect(createWorkerLiteCheckout('t1', 'month', 'nonce-12345678')).rejects.toThrow('gate:link_ended');
    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('rejects a bad interval or nonce before reading anything', async () => {
    admin = makeAdmin(healthy());
    await expect(createWorkerLiteCheckout('t1', 'week' as never, 'nonce-12345678')).rejects.toThrow('bad_interval');
    await expect(createWorkerLiteCheckout('t1', 'month', 'x')).rejects.toThrow('bad_nonce');
    expect(admin.log).toHaveLength(0);
  });

  it('fails if Stripe gives no checkout address', async () => {
    admin = makeAdmin(healthy({ tenant: { data: { closed_at: null, worker_discount_worker_id: 'w1', name: 'Sam Locks', stripe_customer_id: 'cus_old' } } }));
    stripe.checkout.sessions.create.mockResolvedValue({ url: null });
    await expect(createWorkerLiteCheckout('t1', 'month', 'nonce-12345678')).rejects.toThrow('no_url');
  });
});
