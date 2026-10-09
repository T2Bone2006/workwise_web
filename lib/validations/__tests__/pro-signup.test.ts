import { describe, expect, it } from 'vitest';
import { proSignupFormSchema, proSignupSchema } from '@/lib/validations/pro-signup';

const valid = {
  tier: 'growth',
  interval: 'month',
  workers: '40',
  businessName: 'Clearview Locksmiths',
  fullName: 'Sam Jones',
  email: 'sam@example.com',
  password: 'password1',
  phone: '07700 900000',
  trade: 'Locksmith',
  ref: '',
};

describe('proSignupSchema', () => {
  it('accepts a valid Pro form and tidies the phone number', () => {
    const result = proSignupSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phone).toBe('07700900000');
      expect(result.data.workers).toBe(40);
    }
  });

  it('rejects a bad tier, interval, phone, short password, and a missing trade', () => {
    expect(proSignupSchema.safeParse({ ...valid, tier: 'enterprise' }).success).toBe(false);
    expect(proSignupSchema.safeParse({ ...valid, interval: 'weekly' }).success).toBe(false);
    const phone = proSignupSchema.safeParse({ ...valid, phone: '12345' });
    expect(phone.success).toBe(false);
    expect(proSignupSchema.safeParse({ ...valid, password: 'short' }).success).toBe(false);
    const trade = proSignupSchema.safeParse({ ...valid, trade: '' });
    expect(trade.success).toBe(false);
    if (!trade.success) expect(trade.error.issues[0].message).toBe('Tell us what your business does');
  });

  it('drops a worker number that is empty or not a whole number from 1 to 999 (never an error)', () => {
    for (const workers of ['', undefined, '0', '1000', 'abc', '12.5', '-3']) {
      const result = proSignupSchema.safeParse({ ...valid, workers });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.workers).toBeUndefined();
    }
    const edge = proSignupSchema.safeParse({ ...valid, workers: '999' });
    expect(edge.success && edge.data.workers).toBe(999);
  });
});

describe('proSignupFormSchema', () => {
  it('needs matching passwords', () => {
    expect(proSignupFormSchema.safeParse({ ...valid, workers: 40, confirmPassword: 'password1' }).success).toBe(true);
    const bad = proSignupFormSchema.safeParse({ ...valid, workers: 40, confirmPassword: 'different1' });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0].message).toBe('Passwords do not match');
  });
});
