import { describe, expect, it } from 'vitest';
import {
  collectedPence,
  normaliseSignupCode,
  outstandingPence,
  partnerWindowEnd,
  sharePence,
  type CountedInvoice,
} from '@/lib/billing/partner-share';

function at(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

function bill(over: Partial<CountedInvoice> & Pick<CountedInvoice, 'created' | 'amountPaid'>): CountedInvoice {
  return {
    status: 'paid',
    subscriptionId: 'sub_1',
    ...over,
  };
}

describe('normaliseSignupCode', () => {
  it('uppercases a word and rejects anything that is not 3 to 16 letters or digits', () => {
    expect(normaliseSignupCode(' sarah ')).toBe('SARAH');
    expect(normaliseSignupCode('abcd2345')).toBe('ABCD2345');
    expect(normaliseSignupCode('AB')).toBeNull();
    expect(normaliseSignupCode('SA RAH')).toBeNull();
    expect(normaliseSignupCode('A'.repeat(17))).toBeNull();
    expect(normaliseSignupCode(null)).toBeNull();
  });
});

describe('partner share', () => {
  const start = new Date('2026-10-21T12:00:00Z');
  const end = partnerWindowEnd(start);

  it('runs for twelve months and stops at the same instant a year on', () => {
    expect(end.toISOString()).toBe('2027-10-21T12:00:00.000Z');
  });

  it('counts subscription money received inside the window, including a half-price month and not a free one', () => {
    const collected = collectedPence(
      [
        bill({ created: at('2026-10-21T12:00:00Z'), amountPaid: 0 }),
        bill({ created: at('2026-11-21T12:00:00Z'), amountPaid: 1750 }),
        bill({ created: at('2026-12-21T12:00:00Z'), amountPaid: 3500 }),
        bill({ created: at('2027-10-21T12:00:00Z'), amountPaid: 3500 }),
        bill({ created: at('2026-12-21T12:00:00Z'), amountPaid: 500, subscriptionId: null }),
        bill({ created: at('2026-12-21T12:00:00Z'), amountPaid: 3500, status: 'open' }),
      ],
      { start, end },
    );
    expect(collected).toBe(5250);
    expect(sharePence(collected)).toBe(525);
    expect(sharePence(0)).toBe(0);
    expect(sharePence(3500)).toBe(350);
  });

  it('does not ask for money already marked as sent', () => {
    expect(outstandingPence(525, 0)).toBe(525);
    expect(outstandingPence(525, 525)).toBe(0);
    expect(outstandingPence(400, 525)).toBe(0);
  });
});
