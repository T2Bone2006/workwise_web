import { describe, expect, it } from 'vitest';
import { signupSchema } from '../signup';

const base = {
  plan: 'rounds',
  interval: 'month',
  businessName: "Dave's Window Cleaning",
  fullName: 'Dave Smith',
  email: 'dave@example.com',
  password: 'password1',
  phone: '',
  postcode: '',
  trade: '',
  ref: '',
};

describe('signupSchema', () => {
  it('accepts a sign-up with no mobile and no postcode', () => {
    const parsed = signupSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.phone).toBeUndefined();
      expect(parsed.data.postcode).toBeUndefined();
    }
  });

  it('tidies a mobile and a postcode when they are given', () => {
    const parsed = signupSchema.safeParse({ ...base, phone: '07700 900000', postcode: 'sw1a 1aa' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.phone).toBe('07700900000');
      expect(parsed.data.postcode).toBe('SW1A 1AA');
    }
  });

  it('still rejects a mobile or postcode that is wrong', () => {
    expect(signupSchema.safeParse({ ...base, phone: '12345' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, postcode: 'nope' }).success).toBe(false);
  });

  it('still needs a name, a business name, an email and an 8-character password', () => {
    expect(signupSchema.safeParse({ ...base, fullName: '' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, businessName: 'x' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, email: 'not-an-email' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, password: 'short' }).success).toBe(false);
  });
});
