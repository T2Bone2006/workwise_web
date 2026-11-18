import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/stripe/client', () => ({ getStripe: () => ({}), getAppUrl: () => 'http://localhost:3000' }));
vi.mock('@/lib/messaging/text-packs', () => ({ ensureStripeCustomerId: async () => ({ customerId: 'cus_1' }) }));

import { validateAutoTopUpInput } from '@/lib/messaging/auto-top-up';

describe('validateAutoTopUpInput', () => {
  const ok = { packKey: 'texts_250', triggerLeft: 20, monthlyCapPounds: 50 };

  it('accepts the suggested values', () => {
    expect(validateAutoTopUpInput(ok)).toEqual({
      ok: true,
      value: { packKey: 'texts_250', triggerLeft: 20, monthlyCapPence: 5000 },
    });
  });

  it('rejects an unknown pack', () => {
    expect(validateAutoTopUpInput({ ...ok, packKey: 'nope' })).toEqual({ ok: false, error: 'Pick a pack' });
  });

  it('the trigger must be 5 to 200', () => {
    for (const triggerLeft of [4, 201, 12.5, Number.NaN]) {
      expect(validateAutoTopUpInput({ ...ok, triggerLeft })).toMatchObject({ ok: false });
    }
    expect(validateAutoTopUpInput({ ...ok, triggerLeft: 5 })).toMatchObject({ ok: true });
    expect(validateAutoTopUpInput({ ...ok, triggerLeft: 200 })).toMatchObject({ ok: true });
  });

  it('the limit must cover one pack and be at most £1,000', () => {
    expect(validateAutoTopUpInput({ ...ok, monthlyCapPounds: 14 })).toEqual({
      ok: false,
      error: 'Your limit must cover at least one pack (£15)',
    });
    expect(validateAutoTopUpInput({ ...ok, monthlyCapPounds: 15 })).toMatchObject({ ok: true });
    expect(validateAutoTopUpInput({ ...ok, packKey: 'texts_1000', monthlyCapPounds: 49 })).toMatchObject({ ok: false });
    expect(validateAutoTopUpInput({ ...ok, packKey: 'texts_1000', monthlyCapPounds: 50 })).toMatchObject({ ok: true });
    expect(validateAutoTopUpInput({ ...ok, monthlyCapPounds: 1001 })).toEqual({
      ok: false,
      error: 'The most you can set is £1,000',
    });
    expect(validateAutoTopUpInput({ ...ok, monthlyCapPounds: 49.5 })).toMatchObject({ ok: false });
  });
});
