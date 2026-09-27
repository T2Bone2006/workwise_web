import { describe, expect, it } from 'vitest';
import { splitVatInclusive } from '@/lib/payments/vat';

describe('splitVatInclusive', () => {
  it('18 @ 20 → { net: 15, vat: 3 }', () => {
    expect(splitVatInclusive(18, 20)).toEqual({ net: 15, vat: 3 });
  });

  it('10 @ 20 → { net: 8.33, vat: 1.67 }', () => {
    expect(splitVatInclusive(10, 20)).toEqual({ net: 8.33, vat: 1.67 });
  });

  it('0 → { net: 0, vat: 0 }', () => {
    expect(splitVatInclusive(0, 20)).toEqual({ net: 0, vat: 0 });
  });
});
