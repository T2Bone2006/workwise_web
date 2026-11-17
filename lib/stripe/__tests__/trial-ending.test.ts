import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

const { stripe, send } = vi.hoisted(() => ({
  stripe: { customers: { retrieve: vi.fn() }, subscriptions: { update: vi.fn() } },
  send: vi.fn(),
}));
vi.mock('@/lib/stripe/client', () => ({ getStripe: () => stripe, getAppUrl: () => 'https://app.test' }));
vi.mock('@/lib/emails/trial-ending', async (orig) => ({ ...(await orig<typeof import('@/lib/emails/trial-ending')>()), sendTrialEndingEmail: send }));

import { onTrialWillEnd } from '@/lib/stripe/trial-ending';

function sub(over: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    status: 'trialing',
    customer: 'cus_1',
    trial_end: Math.floor(Date.UTC(2026, 10, 20, 12) / 1000),
    metadata: {},
    items: { data: [{ price: { id: 'price_rounds_m' } }] },
    ...over,
  } as unknown as Stripe.Subscription;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_PRICE_ROUNDS = 'price_rounds_m';
  stripe.customers.retrieve.mockResolvedValue({ id: 'cus_1', email: 'a@b.test' });
  send.mockResolvedValue({ ok: true });
});

describe('onTrialWillEnd', () => {
  it('emails the date and the full price, then marks the subscription', async () => {
    expect(await onTrialWillEnd(sub())).toBe('sent');
    const content = send.mock.calls[0][0].content;
    expect(send.mock.calls[0][0].to).toBe('a@b.test');
    expect(content.text).toContain('20 Nov');
    expect(content.text).toContain('£35 a month');
    expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_1', { metadata: { trial_reminder_sent: '1' } });
  });

  it('shows the founder price to a founder', async () => {
    await onTrialWillEnd(sub({ metadata: { founder_place: '1' } }));
    expect(send.mock.calls[0][0].content.text).toContain('£17.50 a month');
  });

  it('sends nothing twice, and nothing for a subscription that is not on a trial', async () => {
    expect(await onTrialWillEnd(sub({ metadata: { trial_reminder_sent: '1' } }))).toBe('skipped');
    expect(await onTrialWillEnd(sub({ status: 'active' }))).toBe('skipped');
    expect(send).not.toHaveBeenCalled();
  });

  it('throws when the email fails, so Stripe retries', async () => {
    send.mockResolvedValue({ ok: false });
    await expect(onTrialWillEnd(sub())).rejects.toThrow();
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });
});
