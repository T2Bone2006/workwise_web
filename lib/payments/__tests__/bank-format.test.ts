import { describe, expect, it } from 'vitest';
import {
  formatSortCode,
  maskAccountNumber,
  normaliseAccountNumber,
  normaliseSortCode,
} from '@/lib/payments/bank-format';

describe('normaliseSortCode / formatSortCode', () => {
  it('accepts dashed, spaced, and plain 6-digit forms', () => {
    expect(normaliseSortCode('12-34-56')).toBe('123456');
    expect(normaliseSortCode('12 34 56')).toBe('123456');
    expect(normaliseSortCode('123456')).toBe('123456');
  });

  it('rejects bad sort codes', () => {
    expect(normaliseSortCode('12345')).toBeNull();
    expect(normaliseSortCode('abcdef')).toBeNull();
  });

  it("formats '123456' → '12-34-56'", () => {
    expect(formatSortCode('123456')).toBe('12-34-56');
    expect(formatSortCode('bad')).toBe('');
  });
});

describe('normaliseAccountNumber / maskAccountNumber', () => {
  it('keeps 8 digits and left-pads 7', () => {
    expect(normaliseAccountNumber('12345678')).toBe('12345678');
    expect(normaliseAccountNumber('1234567')).toBe('01234567');
    expect(normaliseAccountNumber('12 34 56 78')).toBe('12345678');
  });

  it('rejects letters and wrong lengths', () => {
    expect(normaliseAccountNumber('abcd1234')).toBeNull();
    expect(normaliseAccountNumber('123456')).toBeNull();
  });

  it("masks as '••••5678'", () => {
    expect(maskAccountNumber('12345678')).toBe('\u2022\u2022\u2022\u20225678');
  });
});
