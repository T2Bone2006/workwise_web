import { describe, expect, it } from 'vitest';
import { recordPaymentSchema } from '@/lib/validations/payments';

const base = {
  customerId: '11111111-1111-4111-8111-111111111111',
  amount: 12,
  method: 'cash' as const,
  receivedAt: '2026-09-27T11:00:00.000Z',
  appliesToJobId: null,
  clientMutationId: 'payment-1',
};

describe('recordPaymentSchema', () => {
  it('accepts a blank note sent as null', () => {
    const parsed = recordPaymentSchema.safeParse({ ...base, note: null });
    expect(parsed.success).toBe(true);
  });

  it('accepts a note', () => {
    const parsed = recordPaymentSchema.safeParse({ ...base, note: 'on the doorstep' });
    expect(parsed.success).toBe(true);
  });
});
