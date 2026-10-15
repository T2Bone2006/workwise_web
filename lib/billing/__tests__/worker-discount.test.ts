import { beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { method: string; args: unknown[] };
type Answer = { data: unknown; error?: unknown };

/** A stand-in for the admin client; every table answers from a function that sees the calls made on it. */
function makeAdmin(handlers: Record<string, (calls: Call[]) => Answer>) {
  const updates: Array<{ table: string; payload: unknown; calls: Call[] }> = [];
  const log: Array<{ table: string; calls: Call[] }> = [];
  const from = (table: string) => {
    const calls: Call[] = [];
    log.push({ table, calls });
    const answer = (): { data: unknown; error: unknown } => {
      const result = (handlers[table] ?? (() => ({ data: null })))(calls);
      return { data: result.data, error: result.error ?? null };
    };
    const proxy: Record<string, unknown> = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === 'then') return (resolve: (r: unknown) => void) => resolve(answer());
          return (...args: unknown[]) => {
            calls.push({ method: prop, args });
            if (prop === 'update') updates.push({ table, payload: args[0], calls });
            if (prop === 'maybeSingle' || prop === 'single') return Promise.resolve(answer());
            return proxy;
          };
        },
      },
    );
    return proxy;
  };
  return { client: { from }, updates, log };
}

const eqs = (calls: Call[]) => calls.filter((c) => c.method === 'eq').map((c) => `${c.args[0]}=${c.args[1]}`);

let admin: ReturnType<typeof makeAdmin>;
const stripe = { subscriptions: { retrieve: vi.fn(), update: vi.fn() } };
const sendEmail = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => admin.client }));
vi.mock('@/lib/stripe/client', () => ({ getStripe: () => stripe }));
vi.mock('@/lib/emails/worker-price-ended', () => ({ sendWorkerPriceEndedEmail: (...a: unknown[]) => sendEmail(...a) }));

import { reconcileForWorker, reconcileWorkerDiscounts } from '@/lib/billing/worker-discount';

const COUPON = 'worker_lite_20';
const discount = (coupon: string, id = `di_${coupon}`) => ({ id, end: null, source: { coupon: { id: coupon } } });

type World = {
  claim?: Answer; // answer to the claim / revert / clear updates on tenants
  worker?: Answer;
  employerSubs?: Answer;
  tenant?: Record<string, unknown>;
  ownSubs?: Answer;
};

function world(w: World = {}) {
  const tenant = {
    id: 't1',
    name: 'Sam Locks',
    worker_discount_worker_id: 'w1',
    worker_discount_ended_notified_at: null,
    ...w.tenant,
  };
  return makeAdmin({
    tenants: (calls) => {
      if (calls.some((c) => c.method === 'update')) return w.claim ?? { data: [{ id: 't1' }] };
      if (eqs(calls).includes('id=employer')) return { data: { name: 'Acme Locks' } };
      return { data: [tenant] };
    },
    workers: () =>
      w.worker ?? { data: { id: 'w1', invite_status: 'accepted', worker_type: 'company_subcontractor', primary_tenant_id: 'employer' } },
    subscriptions: (calls) => {
      if (eqs(calls).includes('tenant_id=employer')) return w.employerSubs ?? { data: [{ product: 'pro', status: 'manual' }] };
      return w.ownSubs ?? { data: [{ stripe_subscription_id: 'sub_1', product: 'lite', status: 'active', source: 'stripe' }] };
    },
    users: () => ({ data: { email: 'sam@example.com' } }),
  });
}

const ended = { employerSubs: { data: [{ product: 'pro', status: 'canceled' }] } };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  process.env.STRIPE_COUPON_WORKER_LITE = COUPON;
  stripe.subscriptions.retrieve.mockReset().mockResolvedValue({ id: 'sub_1', discounts: [discount(COUPON)] });
  stripe.subscriptions.update.mockReset().mockResolvedValue({});
  sendEmail.mockReset().mockResolvedValue({ ok: true });
});

describe('reconcileWorkerDiscounts: the link has ended', () => {
  it('claims first, takes the worker coupon off, then tells them', async () => {
    admin = world(ended);
    const order: string[] = [];
    stripe.subscriptions.update.mockImplementation(async () => {
      order.push('stripe');
      return {};
    });
    sendEmail.mockImplementation(async () => {
      order.push('email');
      return { ok: true };
    });
    const res = await reconcileWorkerDiscounts();
    expect(res).toEqual({ checked: 1, removed: 1, applied: 0, skipped: 0, errors: 0 });
    expect(admin.updates[0].payload).toMatchObject({ worker_discount_ended_notified_at: expect.any(String) });
    expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_1', { discounts: '' });
    expect(order).toEqual(['stripe', 'email']);
    expect(sendEmail).toHaveBeenCalledWith({ to: 'sam@example.com', businessName: 'Sam Locks', employerName: 'Acme Locks' });
  });

  it('leaves every other discount in place', async () => {
    admin = world(ended);
    stripe.subscriptions.retrieve.mockResolvedValue({ id: 'sub_1', discounts: [discount(COUPON), discount('founding', 'di_founding')] });
    await reconcileWorkerDiscounts();
    expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_1', { discounts: [{ discount: 'di_founding' }] });
  });

  it('puts the claim back and sends nothing when Stripe fails, so tomorrow tries again', async () => {
    admin = world(ended);
    stripe.subscriptions.update.mockRejectedValue(new Error('stripe down'));
    const res = await reconcileWorkerDiscounts();
    expect(res).toMatchObject({ removed: 0, errors: 1 });
    expect(sendEmail).not.toHaveBeenCalled();
    const payloads = admin.updates.map((u) => u.payload);
    expect(payloads[0]).toMatchObject({ worker_discount_ended_notified_at: expect.any(String) });
    expect(payloads[1]).toEqual({ worker_discount_ended_notified_at: null });
  });

  it('does nothing when another run already claimed it (two runs at once → one removal, one email)', async () => {
    admin = world({ ...ended, claim: { data: [] } });
    const res = await reconcileWorkerDiscounts();
    expect(res).toMatchObject({ removed: 0, skipped: 1 });
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('still counts the removal when the email cannot be sent', async () => {
    admin = world(ended);
    sendEmail.mockResolvedValue({ ok: false });
    const res = await reconcileWorkerDiscounts();
    expect(res.removed).toBe(1);
    expect(stripe.subscriptions.update).toHaveBeenCalledTimes(1);
  });

  it('treats a deleted worker as an ended link', async () => {
    admin = world({ worker: { data: null } });
    const res = await reconcileWorkerDiscounts();
    expect(res.removed).toBe(1);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ employerName: null }));
  });

  it('treats a deactivated worker as an ended link', async () => {
    admin = world({ worker: { data: { id: 'w1', invite_status: 'deactivated', worker_type: 'company_subcontractor', primary_tenant_id: 'employer' } } });
    expect((await reconcileWorkerDiscounts()).removed).toBe(1);
  });
});

describe('reconcileWorkerDiscounts: leaves things alone', () => {
  it('changes nothing while the link is live', async () => {
    admin = world();
    const res = await reconcileWorkerDiscounts();
    expect(res).toEqual({ checked: 1, removed: 0, applied: 0, skipped: 0, errors: 0 });
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(admin.updates).toHaveLength(0);
  });

  it('changes nothing when it cannot tell whether the link is live', async () => {
    admin = world({ employerSubs: { data: null, error: { message: 'boom' } } });
    const res = await reconcileWorkerDiscounts();
    expect(res.removed).toBe(0);
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('does not touch a business with no Lite on Stripe', async () => {
    admin = world({ ...ended, ownSubs: { data: [] } });
    const res = await reconcileWorkerDiscounts();
    expect(res).toMatchObject({ checked: 1, removed: 0 });
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
  });

  it('skips everything when the coupon is not configured', async () => {
    delete process.env.STRIPE_COUPON_WORKER_LITE;
    admin = world(ended);
    const res = await reconcileWorkerDiscounts();
    expect(res).toMatchObject({ removed: 0, skipped: 1 });
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it('keeps going to the next business when one fails to read', async () => {
    admin = world();
    stripe.subscriptions.retrieve.mockRejectedValue(new Error('stripe down'));
    const res = await reconcileWorkerDiscounts();
    expect(res).toMatchObject({ checked: 1, errors: 1 });
  });
});

describe('reconcileWorkerDiscounts: the link comes back', () => {
  const back = { tenant: { worker_discount_ended_notified_at: '2026-10-01T00:00:00Z' } };

  it('puts the coupon back and clears the marker when nothing else is on the subscription', async () => {
    admin = world(back);
    stripe.subscriptions.retrieve.mockResolvedValue({ id: 'sub_1', discounts: [] });
    const res = await reconcileWorkerDiscounts();
    expect(res.applied).toBe(1);
    expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_1', { discounts: [{ coupon: COUPON }] });
    expect(admin.updates[0].payload).toEqual({ worker_discount_ended_notified_at: null });
  });

  it('leaves it for a person when another discount is on', async () => {
    admin = world(back);
    stripe.subscriptions.retrieve.mockResolvedValue({ id: 'sub_1', discounts: [discount('founding')] });
    const res = await reconcileWorkerDiscounts();
    expect(res).toMatchObject({ applied: 0, skipped: 1 });
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it('never gives the discount to a business that never had it taken off', async () => {
    admin = world();
    stripe.subscriptions.retrieve.mockResolvedValue({ id: 'sub_1', discounts: [] });
    const res = await reconcileWorkerDiscounts();
    expect(res.applied).toBe(0);
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });
});

describe('reconcileForWorker', () => {
  it('only looks at the businesses linked to that worker', async () => {
    admin = world(ended);
    await reconcileForWorker('w1');
    const list = admin.log.find((entry) => entry.table === 'tenants');
    expect(eqs(list?.calls ?? [])).toContain('worker_discount_worker_id=w1');
    expect(admin.updates).toHaveLength(1);
  });

  it('never throws, even when the list cannot be read', async () => {
    admin = makeAdmin({ tenants: () => ({ data: null, error: { message: 'boom' } }) });
    await expect(reconcileForWorker('w1')).resolves.toBeUndefined();
  });
});
