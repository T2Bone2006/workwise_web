import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';

const sendRoundsWelcomeEmail = vi.fn();
vi.mock('@/lib/emails/rounds-welcome', () => ({
  roundsSignupGetsWelcome: (product: string | null | undefined) => product === 'rounds' || product === 'both',
  sendRoundsWelcomeEmail: (...args: unknown[]) => sendRoundsWelcomeEmail(...args),
}));

import { notifyRoundsWelcome, ROUNDS_WELCOME_SENT } from '@/lib/stripe/rounds-welcome';

const INTENT = '11111111-2222-3333-4444-555555555555';

function adminWith(row: { product: string; email: string; full_name: string } | null, error: { message: string } | null = null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: row, error }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

function stripeWith(customer: { deleted?: boolean; metadata?: Record<string, string> } | null = { metadata: {} }) {
  const retrieve = vi.fn(async () => customer);
  const update = vi.fn(async () => ({ id: 'cus_1' }));
  return {
    stripe: { customers: { retrieve, update } } as unknown as Stripe,
    retrieve,
    update,
  };
}

describe('notifyRoundsWelcome', () => {
  beforeEach(() => {
    sendRoundsWelcomeEmail.mockReset();
    sendRoundsWelcomeEmail.mockResolvedValue({ ok: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('sends once for a Rounds signup and records it on the customer', async () => {
    const { stripe, update } = stripeWith();
    await notifyRoundsWelcome({
      admin: adminWith({ product: 'rounds', email: 'sarah@example.com', full_name: 'Sarah Jones' }),
      stripe,
      intentId: INTENT,
      customerId: 'cus_1',
    });
    expect(sendRoundsWelcomeEmail).toHaveBeenCalledWith({
      to: 'sarah@example.com',
      fullName: 'Sarah Jones',
      intentId: INTENT,
    });
    expect(update).toHaveBeenCalledWith('cus_1', { metadata: { [ROUNDS_WELCOME_SENT]: '1' } });
  });

  it('sends for the Rounds + Lite bundle', async () => {
    const { stripe } = stripeWith();
    await notifyRoundsWelcome({
      admin: adminWith({ product: 'both', email: 'sarah@example.com', full_name: 'Sarah Jones' }),
      stripe,
      intentId: INTENT,
      customerId: 'cus_1',
    });
    expect(sendRoundsWelcomeEmail).toHaveBeenCalledTimes(1);
  });

  it.each(['lite', 'starter', 'growth', 'pro'])('does not email a %s signup', async (product) => {
    const { stripe, retrieve } = stripeWith();
    await notifyRoundsWelcome({
      admin: adminWith({ product, email: 'sarah@example.com', full_name: 'Sarah Jones' }),
      stripe,
      intentId: INTENT,
      customerId: 'cus_1',
    });
    expect(sendRoundsWelcomeEmail).not.toHaveBeenCalled();
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('does not send again once the customer is marked', async () => {
    const { stripe, update } = stripeWith({ metadata: { [ROUNDS_WELCOME_SENT]: '1' } });
    await notifyRoundsWelcome({
      admin: adminWith({ product: 'rounds', email: 'sarah@example.com', full_name: 'Sarah Jones' }),
      stripe,
      intentId: INTENT,
      customerId: 'cus_1',
    });
    expect(sendRoundsWelcomeEmail).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('throws when the send fails, and does not mark the customer, so Stripe retries', async () => {
    sendRoundsWelcomeEmail.mockResolvedValueOnce({ ok: false });
    const { stripe, update } = stripeWith();
    await expect(
      notifyRoundsWelcome({
        admin: adminWith({ product: 'rounds', email: 'sarah@example.com', full_name: 'Sarah Jones' }),
        stripe,
        intentId: INTENT,
        customerId: 'cus_1',
      }),
    ).rejects.toThrow('rounds welcome email failed');
    expect(update).not.toHaveBeenCalled();
  });

  it('throws when the send was not recorded, without the address in the error', async () => {
    const { stripe, update } = stripeWith();
    update.mockRejectedValueOnce(new Error('stripe down for sarah@example.com'));
    await expect(
      notifyRoundsWelcome({
        admin: adminWith({ product: 'rounds', email: 'sarah@example.com', full_name: 'Sarah Jones' }),
        stripe,
        intentId: INTENT,
        customerId: 'cus_1',
      }),
    ).rejects.toThrow('not recorded');
    const logged = JSON.stringify((console.error as ReturnType<typeof vi.fn>).mock.calls);
    expect(logged).not.toContain('sarah@example.com');
  });

  it('does not throw when there is no address to send to', async () => {
    const { stripe } = stripeWith();
    await notifyRoundsWelcome({
      admin: adminWith({ product: 'rounds', email: '  ', full_name: 'Sarah Jones' }),
      stripe,
      intentId: INTENT,
      customerId: 'cus_1',
    });
    expect(sendRoundsWelcomeEmail).not.toHaveBeenCalled();
  });
});
