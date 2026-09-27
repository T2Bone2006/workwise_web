import { describe, expect, it } from 'vitest';
import {
  makePaymentReference,
  referenceBase,
} from '@/lib/payments/reference';

const REF_RE = /^[A-Z]{3,8}[0-9]{2,3}$/;

describe('referenceBase', () => {
  it("'Mrs Sarah Smith' → 'SMITH'", () => {
    expect(referenceBase('Mrs Sarah Smith')).toBe('SMITH');
  });

  it("'J. O'Neil' → 'ONEIL'", () => {
    expect(referenceBase("J. O'Neil")).toBe('ONEIL');
  });

  it("company 'Acme Cleaning Ltd' → 'ACME'", () => {
    expect(referenceBase('ignored', 'Acme Cleaning Ltd')).toBe('ACME');
  });

  it("'Bo' alone → 'CUST'", () => {
    expect(referenceBase('Bo')).toBe('CUST');
  });
});

describe('makePaymentReference', () => {
  it('matches /^[A-Z]{3,8}[0-9]{2,3}$/', () => {
    const ref = makePaymentReference('Sarah Smith', new Set(), {
      random: () => 0.5,
    });
    expect(ref).toMatch(REF_RE);
  });

  it('falls through to three digits when all two-digit suffixes are taken', () => {
    const taken = new Set<string>();
    for (let n = 10; n <= 99; n++) {
      taken.add(`SMITH${n}`);
    }
    let call = 0;
    const ref = makePaymentReference('Sarah Smith', taken, {
      random: () => {
        // First 90 calls are for 2-digit attempts (all collide); then 3-digit.
        call += 1;
        if (call <= 90) return 0; // → 10
        return 0; // → 100
      },
    });
    expect(ref).toBe('SMITH100');
    expect(ref).toMatch(REF_RE);
  });
});
