import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionsCreate = vi.fn();
const sessionsExpire = vi.fn();
const customersCreate = vi.fn();
const clocksCreate = vi.fn();
const createUser = vi.fn();
const signIn = vi.fn();
const lookupReferrer = vi.fn();
const isOwnReferral = vi.fn();

let cookieValue: string | undefined;
let pending: Record<string, unknown> | null;
let inserted: Record<string, unknown> | null;
let updates: Record<string, unknown>[];
let redirectedTo: string | null;
let writes: string[];

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'ww_ref' && cookieValue ? { value: cookieValue } : undefined),
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    redirectedTo = url;
    throw new Error('REDIRECT');
  },
}));

vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    checkout: { sessions: { create: sessionsCreate, expire: sessionsExpire } },
    customers: { create: (...a: unknown[]) => { writes.push('customer'); return customersCreate(...a); } },
    testHelpers: { testClocks: { create: clocksCreate } },
  }),
  getAppUrl: () => 'http://localhost:3000',
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { signInWithPassword: signIn } }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: { admin: { createUser: (...a: unknown[]) => { writes.push('user'); return createUser(...a); } } },
    from(table: string) {
      if (table !== 'signup_intents') throw new Error(`unexpected ${table}`);
      return {
        insert(row: Record<string, unknown>) {
          writes.push('intent');
          inserted = row;
          return { select() { return { single: async () => ({ data: { id: 'intent_1' }, error: null }) }; } };
        },
        update(row: Record<string, unknown>) {
          updates.push(row);
          return { eq: async () => ({ error: null }) };
        },
        select() {
          const api = { eq() { return api; }, maybeSingle: async () => ({ data: pending, error: null }) };
          return api;
        },
      };
    },
  }),
}));

vi.mock('@/lib/billing/offers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/billing/offers')>('@/lib/billing/offers');
  return {
    ...actual,
    lookupReferrer: (...args: unknown[]) => lookupReferrer(...args),
    isOwnReferral: (...args: unknown[]) => isOwnReferral(...args),
  };
});

const PRICE_ENV: Record<string, string> = {
  STRIPE_PRICE_STARTER: 'price_starter_m',
  STRIPE_PRICE_STARTER_YEARLY: 'price_starter_y',
  STRIPE_PRICE_GROWTH: 'price_growth_m',
  STRIPE_PRICE_GROWTH_YEARLY: 'price_growth_y',
  STRIPE_PRICE_PRO: 'price_pro_m',
  STRIPE_PRICE_PRO_YEARLY: 'price_pro_y',
  STRIPE_PRICE_EXTRA_WORKER_STARTER: 'price_extra_starter_m',
  STRIPE_PRICE_EXTRA_WORKER_STARTER_YEARLY: 'price_extra_starter_y',
  STRIPE_PRICE_EXTRA_WORKER_GROWTH: 'price_extra_growth_m',
  STRIPE_PRICE_EXTRA_WORKER_GROWTH_YEARLY: 'price_extra_growth_y',
  STRIPE_PRICE_EXTRA_WORKER_PRO: 'price_extra_pro_m',
  STRIPE_PRICE_EXTRA_WORKER_PRO_YEARLY: 'price_extra_pro_y',
};

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const base = {
  tier: 'growth',
  interval: 'month',
  workers: '40',
  businessName: 'Clearview',
  fullName: 'Sam Jones',
  email: 'sam@example.com',
  password: 'password1',
  phone: '07700900000',
  trade: 'Locksmith',
  ref: '',
};

beforeEach(() => {
  cookieValue = undefined;
  pending = null;
  inserted = null;
  updates = [];
  writes = [];
  redirectedTo = null;
  for (const m of [sessionsCreate, sessionsExpire, customersCreate, clocksCreate, createUser, signIn, lookupReferrer, isOwnReferral]) m.mockReset();
  for (const [key, value] of Object.entries(PRICE_ENV)) process.env[key] = value;
  delete process.env.STRIPE_SIGNUP_TEST_CLOCK;

  lookupReferrer.mockResolvedValue(null);
  isOwnReferral.mockResolvedValue(false);
  createUser.mockResolvedValue({ data: { user: { id: 'user_1' } }, error: null });
  signIn.mockResolvedValue({ error: null });
  customersCreate.mockResolvedValue({ id: 'cus_new' });
  sessionsExpire.mockResolvedValue({ id: 'cs_old' });
  sessionsCreate.mockResolvedValue({ id: 'cs_new', url: 'https://checkout.test/pay' });
});

async function run(fields: Record<string, string> = {}) {
  const { startProSignup } = await import('@/lib/actions/pro-signup');
  await expect(startProSignup(null, form({ ...base, ...fields }))).rejects.toThrow('REDIRECT');
  expect(redirectedTo).toBe('https://checkout.test/pay');
}

async function runExpectingFailure(fields: Record<string, string> = {}) {
  const { startProSignup } = await import('@/lib/actions/pro-signup');
  return startProSignup(null, form({ ...base, ...fields }));
}

describe('startProSignup', () => {
  it('opens Checkout for the plan plus extras already past the allowance, and stores the intent with no offer', async () => {
    await run();
    expect(sessionsCreate).toHaveBeenCalledTimes(1);
    const body = sessionsCreate.mock.calls[0][0];
    expect(body.line_items).toEqual([
      { price: 'price_growth_m', quantity: 1 },
      { price: 'price_extra_growth_m', quantity: 5 },
    ]);
    expect('discounts' in body).toBe(false);
    expect(body.allow_promotion_codes).toBe(false);
    expect(inserted).toMatchObject({
      product: 'growth',
      billing_interval: 'month',
      postcode: null,
      expected_workers: 40,
      trade: 'Locksmith',
      offer: 'none',
      referral_code: null,
      referrer_tenant_id: null,
    });
    expect(customersCreate.mock.calls[0][0].metadata).toMatchObject({ tier: 'growth', kind: 'pro_signup' });
  });

  it('uses the yearly price for a yearly plan', async () => {
    await run({ interval: 'year', tier: 'starter' });
    expect(sessionsCreate.mock.calls[0][0].line_items).toEqual([
      { price: 'price_starter_y', quantity: 1 },
      { price: 'price_extra_starter_y', quantity: 30 },
    ]);
    expect(inserted).toMatchObject({ product: 'starter', billing_interval: 'year' });
  });

  it('charges the extras for a large team and drops a silly worker number', async () => {
    await run({ workers: '200' });
    expect(sessionsCreate.mock.calls[0][0].line_items).toEqual([
      { price: 'price_growth_m', quantity: 1 },
      { price: 'price_extra_growth_m', quantity: 165 },
    ]);
    expect(inserted).toMatchObject({ expected_workers: 200 });
    inserted = null;
    sessionsCreate.mockClear();
    await run({ workers: '12.5', email: 'two@example.com' });
    expect(inserted).toMatchObject({ expected_workers: null });
  });

  it('records a valid referral but gives no discount', async () => {
    lookupReferrer.mockResolvedValue({ tenantId: 'ten_ref', businessName: 'Clearview', code: 'ABCD2345' });
    await run({ ref: 'ABCD2345' });
    expect('discounts' in sessionsCreate.mock.calls[0][0]).toBe(false);
    expect(inserted).toMatchObject({ referral_code: 'ABCD2345', referrer_tenant_id: 'ten_ref', offer: 'none' });
  });

  it('ignores the visitor using their own referral code', async () => {
    lookupReferrer.mockResolvedValue({ tenantId: 'ten_ref', businessName: 'Clearview', code: 'ABCD2345' });
    isOwnReferral.mockResolvedValue(true);
    await run({ ref: 'ABCD2345' });
    expect(inserted).toMatchObject({ referral_code: null, referrer_tenant_id: null });
  });

  it('reads the referral cookie when the form has no code', async () => {
    cookieValue = 'ABCD2345';
    lookupReferrer.mockResolvedValue({ tenantId: 'ten_ref', businessName: 'Clearview', code: 'ABCD2345' });
    await run();
    expect(lookupReferrer).toHaveBeenCalledWith('ABCD2345');
  });

  it('resumes a pending signup: expires the old Checkout, reuses the customer, updates the details', async () => {
    createUser.mockResolvedValue({ data: null, error: { message: 'User already registered' } });
    pending = { id: 'intent_old', auth_user_id: 'user_old', stripe_customer_id: 'cus_old', stripe_checkout_session_id: 'cs_old' };
    await run({ tier: 'pro' });
    expect(sessionsExpire).toHaveBeenCalledWith('cs_old');
    expect(customersCreate).not.toHaveBeenCalled();
    expect(inserted).toBeNull();
    expect(updates[0]).toMatchObject({ product: 'pro', offer: 'none' });
    expect(sessionsCreate.mock.calls[0][0].customer).toBe('cus_old');
  });

  it('refuses an already-registered email that has no pending signup', async () => {
    createUser.mockResolvedValue({ data: null, error: { message: 'User already registered' } });
    const result = await runExpectingFailure();
    expect(result).toMatchObject({ success: false, error: 'An account with this email already exists. Please sign in instead.' });
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it('fails safe when the price variable is missing: nothing is written, no customer is made', async () => {
    delete process.env.STRIPE_PRICE_GROWTH;
    const result = await runExpectingFailure();
    expect(result).toMatchObject({ success: false, error: 'Something went wrong starting your subscription. Please try again.' });
    expect(writes).toEqual([]);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it('returns the first validation message for a bad form', async () => {
    const result = await runExpectingFailure({ trade: '' });
    expect(result).toMatchObject({ success: false, error: 'Tell us what your business does' });
    expect(createUser).not.toHaveBeenCalled();
  });

  it('answers a Stripe failure with the standard message and keeps the login for a retry', async () => {
    sessionsCreate.mockRejectedValue(new Error('stripe down'));
    const result = await runExpectingFailure();
    expect(result).toMatchObject({ success: false, error: 'Something went wrong starting your subscription. Please try again.' });
    expect(redirectedTo).toBeNull();
  });
});
