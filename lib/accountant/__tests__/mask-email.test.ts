import { describe, expect, it } from 'vitest';
import { maskEmail } from '@/lib/accountant/mask-email';

describe('maskEmail', () => {
  it('keeps the first letter and the domain', () => {
    expect(maskEmail('jane@smithaccounts.co.uk')).toBe('j***@smithaccounts.co.uk');
    expect(maskEmail('a@b.com')).toBe('a***@b.com');
  });
  it('never fails on something odd', () => {
    expect(maskEmail('')).toBe('***');
    expect(maskEmail('nope')).toBe('***');
    expect(maskEmail('@x.com')).toBe('***');
  });
});
