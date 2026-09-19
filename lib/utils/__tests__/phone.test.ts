import { describe, expect, it } from 'vitest';
import {
  formatUkPhoneDisplay,
  normalizeUkPhoneE164,
} from '@/lib/utils/phone';

const MOBILE = '+447700900123';

describe('normalizeUkPhoneE164', () => {
  it('accepts national, +44, and 0044 forms of a UK mobile', () => {
    expect(normalizeUkPhoneE164('07700 900123')).toBe(MOBILE);
    expect(normalizeUkPhoneE164('+44 7700 900123')).toBe(MOBILE);
    expect(normalizeUkPhoneE164('0044 7700 900123')).toBe(MOBILE);
    expect(normalizeUkPhoneE164('00447700900123')).toBe(MOBILE);
    expect(normalizeUkPhoneE164('07700-900123')).toBe(MOBILE);
    expect(normalizeUkPhoneE164('(07700) 900123')).toBe(MOBILE);
    expect(normalizeUkPhoneE164('+44 (0) 7700 900123')).toBe(MOBILE);
    expect(normalizeUkPhoneE164('447700900123')).toBe(MOBILE);
  });

  it('accepts a UK geographic number', () => {
    expect(normalizeUkPhoneE164('020 7946 0958')).toBe('+442079460958');
  });

  it('returns null when missing, not UK, or the wrong length', () => {
    expect(normalizeUkPhoneE164(null)).toBeNull();
    expect(normalizeUkPhoneE164(undefined)).toBeNull();
    expect(normalizeUkPhoneE164('')).toBeNull();
    expect(normalizeUkPhoneE164('   ')).toBeNull();
    expect(normalizeUkPhoneE164('07700 90012')).toBeNull();
    expect(normalizeUkPhoneE164('07700 9001234')).toBeNull();
    expect(normalizeUkPhoneE164('+1 555 123 4567')).toBeNull();
    expect(normalizeUkPhoneE164('0033 1 23 45 67 89')).toBeNull();
    expect(normalizeUkPhoneE164('not a phone')).toBeNull();
  });
});

describe('formatUkPhoneDisplay', () => {
  it('formats a mobile E.164 as 07xxx xxxxxx', () => {
    expect(formatUkPhoneDisplay(MOBILE)).toBe('07700 900123');
  });

  it('returns empty for missing or non-UK values', () => {
    expect(formatUkPhoneDisplay(null)).toBe('');
    expect(formatUkPhoneDisplay(undefined)).toBe('');
    expect(formatUkPhoneDisplay('')).toBe('');
    expect(formatUkPhoneDisplay('07700 900123')).toBe('');
    expect(formatUkPhoneDisplay('+15551234567')).toBe('');
  });
});
