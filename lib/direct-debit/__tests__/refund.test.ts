import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const TENANT = '11111111-1111-1111-1111-111111111111';
const PAYMENT = '22222222-2222-2222-2222-222222222222';

const post = vi.fn();
const unlockable = { value: true };
vi.mock('@/lib/gocardless/connection', () => ({
  clientForTenant: async () => (unlockable.value ? { client: { post }, connection: {} } : null),
}));

import { GoCardlessError } from '@/lib/gocardless/client';
import { refundErrorText, refundGoCardlessPayment } from '@/lib/direct-debit/refund';

type Row = Record<string, unknown>;
let payment: Row | null;
let updates: Row[];

function fakeAdmin(): SupabaseClient {
  return {
    from: () => {
      let isUpdate = false;
      const builder = {
        select: () => builder,
        update: (row: Row) => {
          isUpdate = true;
          updates.push(row);
          return builder;
        },
        eq: () => builder,
        lt: () => builder,
        maybeSingle: async () => ({ data: payment, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ data: null, error: isUpdate ? null : null }),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

const base = { tenantId: TENANT, userId: 'user-1', paymentId: PAYMENT };

beforeEach(() => {
  post.mockReset();
  post.mockResolvedValue({ refunds: { id: 'RF1' } });
  unlockable.value = true;
  updates = [];
  payment = {
    id: PAYMENT,
    amount: 15,
    refunded_amount: 0,
    status: 'active',
    source: 'gocardless',
    dispute_status: null,
    gocardless_payment_id: 'PM1',
  };
});

describe('refundGoCardlessPayment', () => {
  it('sends the refund with the running total GoCardless needs, and raises refunded_amount', async () => {
    payment!.refunded_amount = 5;
    const out = await refundGoCardlessPayment(fakeAdmin(), { ...base, amount: 4 });
    expect(out).toEqual({ ok: true, refunded: 4 });
    expect(post).toHaveBeenCalledWith(
      '/refunds',
      {
        refunds: {
          amount: 400,
          total_amount_confirmation: 900,
          links: { payment: 'PM1' },
          metadata: { workwise_payment_id: PAYMENT, workwise_user_id: 'user-1' },
        },
      },
      { idempotencyKey: `rf_${PAYMENT}_500_400` },
    );
    expect(updates).toEqual([{ refunded_amount: 9 }]);
  });

  it('refuses more than is left, a cancelled payment, a non-GoCardless payment and a lost dispute', async () => {
    expect((await refundGoCardlessPayment(fakeAdmin(), { ...base, amount: 15.01 })).ok).toBe(false);
    payment!.status = 'void';
    expect((await refundGoCardlessPayment(fakeAdmin(), { ...base, amount: 5 })).ok).toBe(false);
    payment = { ...payment!, status: 'active', source: 'stripe' };
    expect((await refundGoCardlessPayment(fakeAdmin(), { ...base, amount: 5 })).ok).toBe(false);
    payment = { ...payment!, source: 'gocardless', dispute_status: 'lost' };
    expect((await refundGoCardlessPayment(fakeAdmin(), { ...base, amount: 5 })).ok).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it('a double tap (409 on the same key) counts as the one refund', async () => {
    post.mockRejectedValue(
      new GoCardlessError({ message: 'conflict', status: 409, conflictingResourceId: 'RF1' }),
    );
    expect(await refundGoCardlessPayment(fakeAdmin(), { ...base, amount: 15 })).toEqual({ ok: true, refunded: 15 });
  });

  it('says why GoCardless refused, in plain English', async () => {
    post.mockRejectedValue(
      new GoCardlessError({
        message: 'x',
        status: 422,
        reasons: ['available_refund_amount_insufficient'],
      }),
    );
    log();
    const out = await refundGoCardlessPayment(fakeAdmin(), { ...base, amount: 15 });
    expect(out.ok).toBe(false);
    expect(!out.ok && out.error).toMatch(/refund balance/);
    expect(updates).toEqual([]);
  });

  it('a business that is not connected gets a clear message', async () => {
    unlockable.value = false;
    const out = await refundGoCardlessPayment(fakeAdmin(), { ...base, amount: 5 });
    expect(!out.ok && out.error).toMatch(/isn't connected/);
  });
});

describe('refundErrorText', () => {
  it('maps the permission error to "refunds not switched on"', () => {
    expect(refundErrorText(new GoCardlessError({ message: 'x', status: 403 }))).toMatch(/aren't switched on/);
  });
});

function log() {
  vi.spyOn(console, 'error').mockImplementation(() => {});
}
