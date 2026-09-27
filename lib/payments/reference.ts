const TITLES = new Set([
  'MR',
  'MRS',
  'MS',
  'MISS',
  'DR',
  'PROF',
]);

const COMPANY_SUFFIXES = new Set([
  'LTD',
  'LIMITED',
  'PLC',
  'LLP',
  'CO',
]);

function lettersOnly(word: string): string {
  return word.replace(/[^A-Za-z]/g, '').toUpperCase();
}

function tokenize(raw: string): string[] {
  return raw
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function dropTitles(words: string[]): string[] {
  return words.filter((w) => !TITLES.has(lettersOnly(w)));
}

function dropCompanySuffixes(words: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const upper = w.toUpperCase().replace(/\./g, '');
    // "& Co" / "and Co"
    if (
      (upper === '&' || upper === 'AND') &&
      i + 1 < words.length &&
      lettersOnly(words[i + 1]!) === 'CO'
    ) {
      i += 1;
      continue;
    }
    if (COMPANY_SUFFIXES.has(lettersOnly(w))) continue;
    out.push(w);
  }
  return out;
}

function padBase(primary: string, others: string[]): string {
  let base = primary.slice(0, 8);
  if (base.length >= 3) return base;
  for (const word of others) {
    base = (base + lettersOnly(word)).slice(0, 8);
    if (base.length >= 3) return base;
  }
  return base.length >= 3 ? base : 'CUST';
}

/**
 * Base for a payment reference from a customer name. Drops titles and company
 * suffixes, takes the LAST remaining word for a person or the FIRST word when
 * companyName is given, keeps A–Z only, upper-cases, cuts to 8 letters.
 * Fewer than 3 letters → pads from the next word, else 'CUST'.
 */
export function referenceBase(
  name: string,
  companyName?: string | null,
): string {
  if (companyName && companyName.trim()) {
    const words = dropCompanySuffixes(tokenize(companyName));
    if (words.length === 0) return 'CUST';
    const first = lettersOnly(words[0]!);
    const rest = words.slice(1).map(lettersOnly).filter(Boolean);
    return padBase(first, rest);
  }

  const words = dropTitles(tokenize(name));
  if (words.length === 0) return 'CUST';
  const last = lettersOnly(words[words.length - 1]!);
  const earlier = words
    .slice(0, -1)
    .reverse()
    .map(lettersOnly)
    .filter(Boolean);
  return padBase(last, earlier);
}

/**
 * BASE + 2 random digits (10–99). `taken` holds upper-cased references already
 * used by this business. Tries up to 90 two-digit suffixes, then 3 digits
 * (100–999).
 */
export function makePaymentReference(
  name: string,
  taken: ReadonlySet<string>,
  opts?: { companyName?: string | null; random?: () => number },
): string {
  const base = referenceBase(name, opts?.companyName);
  const random = opts?.random ?? Math.random;
  const takenUpper = taken;

  for (let i = 0; i < 90; i++) {
    const n = Math.floor(random() * 90) + 10;
    const ref = `${base}${n}`;
    if (!takenUpper.has(ref.toUpperCase())) return ref;
  }

  for (let i = 0; i < 900; i++) {
    const n = Math.floor(random() * 900) + 100;
    const ref = `${base}${n}`;
    if (!takenUpper.has(ref.toUpperCase())) return ref;
  }

  // Extremely unlikely: every 2- and 3-digit suffix taken.
  throw new Error(`makePaymentReference: no free suffix for ${base}`);
}
