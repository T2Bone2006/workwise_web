import { describe, expect, it } from 'vitest';
import {
  matchPayer,
  normaliseEmail,
  normaliseName,
  normalisePostcode,
  type MatchCandidate,
} from '@/lib/direct-debit/match';

describe('normalise', () => {
  it('emails', () => {
    expect(normaliseEmail('  Jane.Wright@Example.COM ')).toBe('jane.wright@example.com');
    expect(normaliseEmail('   ')).toBeNull();
    expect(normaliseEmail(null)).toBeNull();
  });

  it('names', () => {
    expect(normaliseName('Mrs  Jane Wright')).toBe('jane wright');
    expect(normaliseName('Dr. J. Smith-Jones')).toBe('j smith jones');
    expect(normaliseName("Mr & Mrs O'Brien")).toBe('obrien');
    expect(normaliseName('Mr')).toBeNull();
    expect(normaliseName(undefined)).toBeNull();
  });

  it('postcodes', () => {
    expect(normalisePostcode(' sw1a 1aa ')).toBe('SW1A1AA');
    expect(normalisePostcode('')).toBeNull();
  });
});

describe('matchPayer', () => {
  const jane: MatchCandidate = {
    customerId: 'jane',
    email: 'jane@example.com',
    name: 'Mrs Jane Wright',
    postcodes: ['LS1 4AB'],
    hasLiveDirectDebit: false,
  };
  const bob: MatchCandidate = {
    customerId: 'bob',
    email: 'bob@example.com',
    name: 'Bob Green',
    postcodes: ['LS2 9ZZ', 'LS3 1AA'],
    hasLiveDirectDebit: false,
  };

  it('same email (case and spaces ignored) → email', () => {
    expect(
      matchPayer({ email: ' JANE@example.com ', name: 'Someone Else', postcode: null }, [jane, bob]),
    ).toEqual({ kind: 'email', customerId: 'jane' });
  });

  it('same name (titles dropped) and postcode (spacing ignored) → name_postcode', () => {
    expect(
      matchPayer({ email: 'other@example.com', name: 'Jane Wright', postcode: 'ls14ab' }, [jane, bob]),
    ).toEqual({ kind: 'name_postcode', customerId: 'jane' });
    expect(
      matchPayer({ email: null, name: 'bob green', postcode: 'LS3 1AA' }, [jane, bob]),
    ).toEqual({ kind: 'name_postcode', customerId: 'bob' });
  });

  it('same name but a different postcode → none', () => {
    expect(matchPayer({ email: null, name: 'Jane Wright', postcode: 'M1 1AA' }, [jane])).toEqual({
      kind: 'none',
      customerId: null,
    });
  });

  it('two customers with the same email (a landlord) → none', () => {
    const flat = { ...bob, customerId: 'flat-2', email: 'Jane@example.com' };
    expect(matchPayer({ email: 'jane@example.com', name: null, postcode: null }, [jane, flat])).toEqual({
      kind: 'none',
      customerId: null,
    });
  });

  it('two customers with the same name and postcode → none', () => {
    const twin = { ...jane, customerId: 'twin', email: null };
    expect(
      matchPayer({ email: null, name: 'Jane Wright', postcode: 'LS1 4AB' }, [jane, twin]),
    ).toEqual({ kind: 'none', customerId: null });
  });

  it('never suggests a customer who already has a live Direct Debit', () => {
    const covered = { ...jane, hasLiveDirectDebit: true };
    expect(matchPayer({ email: 'jane@example.com', name: null, postcode: null }, [covered])).toEqual({
      kind: 'none',
      customerId: null,
    });
    expect(
      matchPayer({ email: null, name: 'Jane Wright', postcode: 'LS1 4AB' }, [covered]),
    ).toEqual({ kind: 'none', customerId: null });
  });

  it('nothing to go on → none', () => {
    expect(matchPayer({ email: null, name: null, postcode: null }, [jane])).toEqual({
      kind: 'none',
      customerId: null,
    });
  });
});
