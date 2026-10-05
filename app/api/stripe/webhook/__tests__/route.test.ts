import { beforeEach, describe, expect, it, vi } from 'vitest';

const { order, retrieveInvoice, provisionFromCheckoutSession, onInvoicePaid, constructEvent } = vi.hoisted(() => {
  const order: string[] = [];
  return {
    order,
    retrieveInvoice: vi.fn(),
    provisionFromCheckoutSession: vi.fn(async () => {
      order.push('provision');
      return 'tenant-1';
    }),
    onInvoicePaid: vi.fn(async () => {
      order.push('onInvoicePaid');
      return { result: 'rewarded' };
    }),
    constructEvent: vi.fn(),
  };
});

vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    webhooks: { constructEvent },
    invoices: { retrieve: retrieveInvoice },
    subscriptions: { retrieve: vi.fn() },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: async () => ({ error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
      delete: () => ({ eq: async () => ({ error: null }) }),
    }),
  }),
}));
vi.mock('@/lib/messaging/text-packs', () => ({ creditTextPackFromSession: vi.fn() }));
vi.mock('@/lib/stripe/provision', () => ({ provisionFromCheckoutSession }));
vi.mock('@/lib/stripe/sync-subscription', () => ({ syncRestartSession: vi.fn(), syncSubscription: vi.fn() }));
vi.mock('@/lib/billing/referrals', () => ({ onInvoicePaid, onSubscriptionEnded: vi.fn() }));
vi.mock('@/lib/billing/second-month', () => ({ onFirstInvoicePaid: vi.fn() }));

import { POST } from '@/app/api/stripe/webhook/route';

function request() {
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 't=1,v1=x' },
    body: '{}',
  });
}

describe('checkout.session.completed for a new signup', () => {
  beforeEach(() => {
    order.length = 0;
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  });

  it('looks at the first invoice again once the business exists, so a referral reward is not lost to invoice.paid arriving first', async () => {
    constructEvent.mockReturnValue({
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', mode: 'subscription', metadata: {}, invoice: 'in_1' } },
    });
    retrieveInvoice.mockResolvedValue({ id: 'in_1', status: 'paid' });

    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(retrieveInvoice).toHaveBeenCalledWith('in_1');
    expect(onInvoicePaid).toHaveBeenCalledWith({ id: 'in_1', status: 'paid' });
    expect(order).toEqual(['provision', 'onInvoicePaid']);
  });

  it('does not touch invoices for a session with no invoice, and still provisions', async () => {
    constructEvent.mockReturnValue({
      id: 'evt_2',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_2', mode: 'subscription', metadata: {}, invoice: null } },
    });
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(retrieveInvoice).not.toHaveBeenCalled();
    expect(onInvoicePaid).not.toHaveBeenCalled();
    expect(provisionFromCheckoutSession).toHaveBeenCalledTimes(1);
  });
});
