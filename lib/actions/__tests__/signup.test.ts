import { beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';

const sessionsCreate = vi.fn();
const sessionsExpire = vi.fn();
const customersCreate = vi.fn();
const clocksCreate = vi.fn();
const createUser = vi.fn();
const signIn = vi.fn();
const getFoundingStatus = vi.fn();
const lookupReferrer = vi.fn();
const isOwnReferral = vi.fn();

let cookieValue: string | undefined;
let pending: Record<string, unknown> | null;
let inserted: Record<string, unknown> | null;
let updates: Record<string, unknown>[];
let redirectedTo: string | null;

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
    customers: { create: customersCreate },
    testHelpers: { testClocks: { create: clocksCreate } },
  }),
  getAppUrl: () => 'http://localhost:3000',
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { signInWithPassword: signIn } }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: { admin: { createUser } },
    from(table: string) {
      if (table !== 'signup_intents') throw new Error(`unexpected ${table}`);
      return {
        insert(row: Record<string, unknown>) {
          inserted = row;
          return {
            select() {
              return {
                single: async () => ({ data: { id: 'intent_1' }, error: null }),
              };
            },
          };
        },
        update(row: Record<string, unknown>) {
          updates.push(row);
          return { eq: async () => ({ error: null }) };
        },
        select() {
          const api = {
            eq() {
              return api;
            },
            maybeSingle: async () => ({ data: pending, error: null }),
          };
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
    getFoundingStatus: (...args: unknown[]) => getFoundingStatus(...args),
    lookupReferrer: (...args: unknown[]) => lookupReferrer(...args),
    isOwnReferral: (...args: unknown[]) => isOwnReferral(...args),
  };
});

const PRICE_ENV: Record<string, string> = {
  STRIPE_PRICE_ROUNDS: 'price_rounds_m',
  STRIPE_PRICE_LITE: 'price_lite_m',
  STRIPE_PRICE_BOTH: 'price_both_m',
  STRIPE_PRICE_ROUNDS_YEARLY: 'price_rounds_y',
  STRIPE_PRICE_LITE_YEARLY: 'price_lite_y',
  STRIPE_PRICE_BOTH_YEARLY: 'price_both_y',
  STRIPE_COUPON_FOUNDING: 'FOUNDING50',
  STRIPE_COUPON_REFERRAL_MONTH: 'REFERRAL_MONTH',
  STRIPE_COUPON_REFERRAL_YEAR_35: 'REFERRAL_YEAR_35',
  STRIPE_COUPON_REFERRAL_YEAR_59: 'REFERRAL_YEAR_59',
};

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const base = {
  plan: 'rounds',
  interval: 'month',
  businessName: 'Clearview',
  fullName: 'Sam Jones',
  email: 'sam@example.com',
  password: 'password1',
  phone: '07700900000',
  postcode: 'SW1A 1AA',
  trade: '',
  ref: '',
};

beforeEach(() => {
  cookieValue = undefined;
  pending = null;
  inserted = null;
  updates = [];
  redirectedTo = null;
  sessionsCreate.mockReset();
  sessionsExpire.mockReset();
  customersCreate.mockReset();
  clocksCreate.mockReset();
  createUser.mockReset();
  signIn.mockReset();
  getFoundingStatus.mockReset();
  lookupReferrer.mockReset();
  isOwnReferral.mockReset();

  for (const [key, value] of Object.entries(PRICE_ENV)) process.env[key] = value;
  delete process.env.STRIPE_SIGNUP_TEST_CLOCK;

  getFoundingStatus.mockResolvedValue({ active: true, placesLeft: 200, places: 200 });
  lookupReferrer.mockResolvedValue(null);
  isOwnReferral.mockResolvedValue(false);
  createUser.mockResolvedValue({ data: { user: { id: 'user_1' } }, error: null });
  signIn.mockResolvedValue({ error: null });
  customersCreate.mockResolvedValue({ id: 'cus_new' });
  sessionsExpire.mockResolvedValue({ id: 'cs_old' });
  sessionsCreate.mockResolvedValue({ id: 'cs_new', url: 'https://checkout.test/pay' });
});

async function run(fields: Record<string, string> = {}) {
  const { startSignup } = await import('@/lib/actions/signup');
  await expect(startSignup(null, form({ ...base, ...fields }))).rejects.toThrow('REDIRECT');
  expect(redirectedTo).toBe('https://checkout.test/pay');
}

describe('startSignup', () => {
  it('applies the founding coupon to a new monthly signup', async () => {
    await run();
    expect(sessionsCreate).toHaveBeenCalledTimes(1);
    expect(sessionsCreate.mock.calls[0][0].discounts).toEqual([{ coupon: 'FOUNDING50' }]);
    expect(sessionsCreate.mock.calls[0][0].line_items).toEqual([{ price: 'price_rounds_m', quantity: 1 }]);
    expect(JSON.stringify(sessionsCreate.mock.calls)).not.toContain('trial_period_days');
  });

  it('gives a referred yearly bundle £59 off and still records the referrer during founding', async () => {
    lookupReferrer.mockResolvedValue({ tenantId: 'ten_ref', businessName: 'Clearview', code: 'ABCD2345' });
    await run({ plan: 'both', interval: 'year', ref: 'ABCD2345' });
    expect(sessionsCreate.mock.calls[0][0].discounts).toEqual([{ coupon: 'REFERRAL_YEAR_59' }]);
    expect(sessionsCreate.mock.calls[0][0].line_items).toEqual([{ price: 'price_both_y', quantity: 1 }]);
    expect(inserted).toMatchObject({
      product: 'both',
      billing_interval: 'year',
      referral_code: 'ABCD2345',
      referrer_tenant_id: 'ten_ref',
      offer: 'month_off_year',
    });
  });

  it('gives a referred monthly trader a free month, then half price, while founding runs', async () => {
    lookupReferrer.mockResolvedValue({ tenantId: 'ten_ref', businessName: 'Clearview', code: 'ABCD2345' });
    await run({ ref: 'ABCD2345' });
    const body = sessionsCreate.mock.calls[0][0];
    expect(body.discounts).toEqual([{ coupon: 'REFERRAL_MONTH' }]);
    expect(body.subscription_data.metadata).toMatchObject({ offer: 'free_month', second_month_half: '1' });
    expect(inserted).toMatchObject({ offer: 'free_month', referrer_tenant_id: 'ten_ref' });
  });

  it('keeps the plain founding offer for someone who was not referred', async () => {
    await run({});
    const body = sessionsCreate.mock.calls[0][0];
    expect(body.discounts).toEqual([{ coupon: 'FOUNDING50' }]);
    expect(body.subscription_data.metadata.second_month_half).toBeUndefined();
    expect(inserted).toMatchObject({ offer: 'founding' });
  });

  it('retries once without a discount when Stripe refuses the founding coupon', async () => {
    sessionsCreate
      .mockRejectedValueOnce(
        new Stripe.errors.StripeInvalidRequestError({
          type: 'invalid_request_error',
          message: 'No such coupon',
          param: 'discounts[0][coupon]',
          code: 'resource_missing',
        })
      )
      .mockResolvedValueOnce({ id: 'cs_retry', url: 'https://checkout.test/pay' });
    await run({});
    expect(sessionsCreate).toHaveBeenCalledTimes(2);
    expect(sessionsCreate.mock.calls[1][0].discounts).toBeUndefined();
    expect(updates.some((row) => row.offer === 'none')).toBe(true);
  });

  it('expires the open Checkout when the same email resumes', async () => {
    createUser.mockResolvedValue({ data: { user: null }, error: { message: 'User already exists' } });
    pending = {
      id: 'intent_old',
      auth_user_id: 'user_old',
      stripe_customer_id: 'cus_old',
      stripe_checkout_session_id: 'cs_old',
    };
    await run({ plan: 'lite', interval: 'year' });
    expect(sessionsExpire).toHaveBeenCalledWith('cs_old');
    expect(customersCreate).not.toHaveBeenCalled();
    expect(sessionsCreate.mock.calls[0][0].customer).toBe('cus_old');
    expect(inserted).toBeNull();
  });

  it('ignores a referral that uses the referrer’s own email', async () => {
    lookupReferrer.mockResolvedValue({ tenantId: 'ten_ref', businessName: 'Clearview', code: 'ABCD2345' });
    isOwnReferral.mockResolvedValue(true);
    await run({ ref: 'ABCD2345' });
    expect(inserted).toMatchObject({ referral_code: null, referrer_tenant_id: null, offer: 'founding' });
  });

  it('never sends a trial', async () => {
    await run({ plan: 'both', interval: 'year' });
    expect(JSON.stringify(sessionsCreate.mock.calls)).not.toContain('trial_period_days');
    expect(JSON.stringify(customersCreate.mock.calls)).not.toContain('trial_period_days');
  });
});
