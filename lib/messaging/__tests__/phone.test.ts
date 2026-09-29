import { describe, expect, it } from 'vitest';
import { isUkMobileE164, maskPhone } from '@/lib/messaging/phone';

describe('isUkMobileE164', () => {
  it('is true only for +447 followed by exactly 9 digits', () => {
    expect(isUkMobileE164('+447700900123')).toBe(true);
    expect(isUkMobileE164('07700900123')).toBe(false);
    expect(isUkMobileE164('+441234567890')).toBe(false);
    expect(isUkMobileE164('+4477009001234')).toBe(false);
    expect(isUkMobileE164(null)).toBe(false);
    expect(isUkMobileE164('')).toBe(false);
  });
});

describe('maskPhone', () => {
  it('masks a UK mobile for logs', () => {
    expect(maskPhone('+447700900123')).toBe('+44 77•• ••0123');
    expect(maskPhone('07700900123')).toBe('•••');
    expect(maskPhone(null)).toBe('•••');
  });
});
