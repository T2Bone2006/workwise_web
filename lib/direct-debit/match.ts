/** D21 matching of a switcher's existing Direct Debits to WorkWise customers. Pure. */

const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'mx']);

/** trim, lowercase, '' → null */
export function normaliseEmail(e: string | null | undefined): string | null {
  const value = e?.trim().toLowerCase() ?? '';
  return value === '' ? null : value;
}

/** lowercase, drop Mr/Mrs/Ms/Miss/Dr/Mx, punctuation, extra spaces */
export function normaliseName(n: string | null | undefined): string | null {
  if (!n) return null;
  const words = n
    .toLowerCase()
    .replace(/[-–—/&]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter((word) => word !== '' && !TITLES.has(word));
  return words.length === 0 ? null : words.join(' ');
}

/** uppercase, no spaces */
export function normalisePostcode(p: string | null | undefined): string | null {
  const value = p?.replace(/\s+/g, '').toUpperCase() ?? '';
  return value === '' ? null : value;
}

export type MatchCandidate = {
  customerId: string;
  email: string | null;
  name: string;
  postcodes: string[];
  hasLiveDirectDebit: boolean;
};

export type MatchResult = { kind: 'email' | 'name_postcode' | 'none'; customerId: string | null };

const NONE: MatchResult = { kind: 'none', customerId: null };

/**
 * email: exactly one candidate with the same normalised email. name_postcode:
 * exactly one candidate with the same normalised name AND one of its postcodes
 * equal to the payer's. Ties (two customers) → none. Candidates with
 * hasLiveDirectDebit are never suggested.
 */
export function matchPayer(
  payer: { email: string | null; name: string | null; postcode: string | null },
  candidates: MatchCandidate[],
): MatchResult {
  const email = normaliseEmail(payer.email);
  if (email) {
    // A tie counts every customer with the email, including ones that
    // already have a Direct Debit: the trader should choose.
    const sameEmail = candidates.filter((c) => normaliseEmail(c.email) === email);
    if (sameEmail.length === 1) {
      return sameEmail[0].hasLiveDirectDebit
        ? NONE
        : { kind: 'email', customerId: sameEmail[0].customerId };
    }
    if (sameEmail.length > 1) return NONE;
  }

  const name = normaliseName(payer.name);
  const postcode = normalisePostcode(payer.postcode);
  if (!name || !postcode) return NONE;
  const samePerson = candidates.filter(
    (c) =>
      normaliseName(c.name) === name &&
      c.postcodes.some((p) => normalisePostcode(p) === postcode),
  );
  if (samePerson.length !== 1 || samePerson[0].hasLiveDirectDebit) return NONE;
  return { kind: 'name_postcode', customerId: samePerson[0].customerId };
}
