import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionsCreate = vi.fn();
const sessionsExpire = vi.fn();
const getFoundingStatus = vi.fn();

let intent: Record<string, unknown> | null;
let updates: Record<string, unknown>[];

vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    checkout: { sessions: { create: sessionsCreate, expire: sessionsExpire } },
  }),
  getAppUrl: () => 'http://localhost:3000',
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table !== 'signup_intents') throw new Error(`unexpected ${table}`);
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data: intent, error: null }),
              };
            },
          };
        },
        update(row: Record<string, unknown>) {
          updates.push(row);
          return { eq: async () => ({ error: null }) };
        },
      };
    },
  }),
}));

vi.mock('@/lib/billing/offers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/billing/offers')>('@/lib/billing/offers');
  return { ...actual, getFoundingStatus: (...args: unknown[]) => getFoundingStatus(...args) };
});

const PRICE_ENV: Record<string, string> = {
  STRIPE_PRICE_BOTH: 'price_both_m',
  STRIPE_PRICE_BOTH_YEARLY: 'price_both_y',
  STRIPE_COUPON_FOUNDING: 'FOUNDING50',
  STRIPE_COUPON_REFERRAL_MONTH: 'REFERRAL_MONTH',
  STRIPE_COUPON_REFERRAL_YEAR_35: 'REFERRAL_YEAR_35',
  STRIPE_COUPON_REFERRAL_YEAR_59: 'REFERRAL_YEAR_59',
};

beforeEach(() => {
  intent = null;
  updates = [];
  sessionsCreate.mockReset();
  sessionsExpire.mockReset();
  getFoundingStatus.mockReset();
  for (const [key, value] of Object.entries(PRICE_ENV)) process.env[key] = value;
  getFoundingStatus.mockResolvedValue({ active: true, placesLeft: 200, places: 200 });
  sessionsExpire.mockResolvedValue({ id: 'cs_old' });
  sessionsCreate.mockResolvedValue({ id: 'cs_new', url: 'https://checkout.test/pay' });
});

describe('resumePendingCheckout', () => {
  it('opens Checkout for the stored plan instead of sending them to an empty dashboard', async () => {
    intent = {
      id: 'intent_1',
      status: 'pending',
      product: 'both',
      billing_interval: 'month',
      stripe_customer_id: 'cus_1',
      stripe_checkout_session_id: 'cs_old',
      referrer_tenant_id: null,
      expected_workers: null,
    };
    const { resumePendingCheckout } = await import('@/lib/billing/resume-checkout');
    const result = await resumePendingCheckout('user_1');
    expect(result).toEqual({ kind: 'url', url: 'https://checkout.test/pay' });
    expect(sessionsExpire).toHaveBeenCalledWith('cs_old');
    const body = sessionsCreate.mock.calls[0][0];
    expect(body.customer).toBe('cus_1');
    expect(body.line_items).toEqual([{ price: 'price_both_m', quantity: 1 }]);
    expect(body.discounts).toEqual([{ coupon: 'FOUNDING50' }]);
    expect(body.subscription_data.metadata).toMatchObject({ plan: 'both', interval: 'month', offer: 'founding' });
    expect(body).not.toHaveProperty('trial_period_days');
    expect(updates.some((row) => row.stripe_checkout_session_id === 'cs_new')).toBe(true);
  });

  it('sends a login with no pending signup to the dashboard', async () => {
    intent = null;
    const { resumePendingCheckout } = await import('@/lib/billing/resume-checkout');
    expect(await resumePendingCheckout('user_1')).toEqual({ kind: 'dashboard' });
    expect(sessionsCreate).not.toHaveBeenCalled();
  });
});
