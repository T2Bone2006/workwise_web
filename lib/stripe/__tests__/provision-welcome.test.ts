import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

const notifyRoundsWelcome = vi.fn();
vi.mock('@/lib/stripe/rounds-welcome', () => ({
  notifyRoundsWelcome: (...args: unknown[]) => notifyRoundsWelcome(...args),
}));

const intentMaybe = vi.fn();
const sessionUpdate = vi.fn();
const workerMaybe = vi.fn();
const rpc = vi.fn();
const updateCustomer = vi.fn();
const retrieveSub = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'signup_intents') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: intentMaybe }) }),
          update: () => ({ eq: () => ({ is: sessionUpdate }) }),
        };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: workerMaybe }) }),
      };
    },
    rpc,
  }),
}));

vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    subscriptions: { retrieve: retrieveSub },
    customers: { update: updateCustomer },
  }),
}));

vi.mock('@/lib/utils/postcode', () => ({ postcodeToLatLng: async () => null }));

import { provisionFromCheckoutSession } from '@/lib/stripe/provision';

function session(): Stripe.Checkout.Session {
  return {
    id: 'cs_1',
    client_reference_id: 'intent-1',
    customer: 'cus_1',
    subscription: 'sub_1',
  } as Stripe.Checkout.Session;
}

describe('provisionFromCheckoutSession welcome email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    intentMaybe.mockResolvedValue({ data: { product: 'rounds', billing_interval: 'month' }, error: null });
    sessionUpdate.mockResolvedValue({ error: null });
    workerMaybe.mockResolvedValue({ data: null, error: null });
    rpc.mockResolvedValue({ data: 'tenant-1', error: null });
    updateCustomer.mockResolvedValue({ id: 'cus_1' });
    retrieveSub.mockResolvedValue({
      id: 'sub_1',
      customer: 'cus_1',
      status: 'active',
      items: { data: [{ price: { id: 'price_x' }, quantity: 1 }] },
      cancel_at_period_end: false,
    });
    notifyRoundsWelcome.mockResolvedValue(undefined);
  });

  it('asks for the Rounds thank-you after the account exists', async () => {
    await expect(provisionFromCheckoutSession(session())).resolves.toBe('tenant-1');
    expect(rpc).toHaveBeenCalled();
    expect(notifyRoundsWelcome).toHaveBeenCalledTimes(1);
    const args = notifyRoundsWelcome.mock.calls[0][0] as { intentId: string; customerId: string };
    expect(args.intentId).toBe('intent-1');
    expect(args.customerId).toBe('cus_1');
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(notifyRoundsWelcome.mock.invocationCallOrder[0]);
  });

  it('leaves the account unconfirmed when the thank-you fails, so Stripe retries', async () => {
    notifyRoundsWelcome.mockRejectedValueOnce(new Error('rounds welcome email failed'));
    await expect(provisionFromCheckoutSession(session())).rejects.toThrow('rounds welcome email failed');
  });
});
