import { describe, expect, it } from 'vitest';
import { HAND_RECORDED_METHODS, paymentMethodLabel } from '@/lib/payments/method-labels';
import { paymentMethodLabel as receiptWording } from '@/lib/payments/messages';
import { paymentMethodSchema } from '@/lib/validations/payments';

describe('paymentMethodLabel', () => {
  it.each([
    ['cash', 'Cash'],
    ['cheque', 'Cheque'],
    ['bank_transfer', 'Bank transfer'],
    ['card', 'Card'],
    ['direct_debit', 'Direct Debit'],
    ['pay_by_bank', 'Pay by Bank'],
    ['other', 'Other'],
  ])('%s → %s', (method, label) => {
    expect(paymentMethodLabel(method)).toBe(label);
  });

  it('unknown, empty or missing methods show Other, never blank', () => {
    expect(paymentMethodLabel('paypal')).toBe('Other');
    expect(paymentMethodLabel('')).toBe('Other');
    expect(paymentMethodLabel(null)).toBe('Other');
    expect(paymentMethodLabel(undefined)).toBe('Other');
    expect(paymentMethodLabel('toString')).toBe('Other');
  });
});

describe('HAND_RECORDED_METHODS', () => {
  it('never includes Direct Debit or Pay by Bank', () => {
    expect(HAND_RECORDED_METHODS).not.toContain('direct_debit');
    expect(HAND_RECORDED_METHODS).not.toContain('pay_by_bank');
    expect([...HAND_RECORDED_METHODS]).toEqual(['cash', 'cheque', 'bank_transfer', 'other']);
  });

  it("the server refuses to record Direct Debit or Pay by Bank by hand", () => {
    expect(paymentMethodSchema.safeParse('direct_debit').success).toBe(false);
    expect(paymentMethodSchema.safeParse('pay_by_bank').success).toBe(false);
    for (const method of HAND_RECORDED_METHODS) {
      expect(paymentMethodSchema.safeParse(method).success).toBe(true);
    }
  });
});

describe('thank-you wording', () => {
  it('reads naturally in "by …" for the new methods', () => {
    expect(receiptWording('pay_by_bank')).toBe('bank');
    expect(receiptWording('direct_debit')).toBe('Direct Debit');
  });
});
