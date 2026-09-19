const UK_E164_RE = /^\+44[1-9]\d{9}$/;

function digitsAndPlus(raw: string): string {
  return raw.replace(/[^\d+]/g, '');
}

/**
 * '07700 900123' | '+44 7700 900123' | '0044…' → '+447700900123'.
 * null if not a UK number.
 */
export function normalizeUkPhoneE164(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null;
  let s = digitsAndPlus(raw.trim());
  if (!s) return null;

  if (s.startsWith('0044')) s = `+44${s.slice(4)}`;
  else if (s.startsWith('44') && !s.startsWith('+')) s = `+${s}`;

  // +44 (0) 7700… — the trunk 0 after the country code.
  if (s.startsWith('+440')) s = `+44${s.slice(4)}`;

  if (s.startsWith('0')) s = `+44${s.slice(1)}`;

  if (!UK_E164_RE.test(s)) return null;
  return s;
}

/** '+447700900123' → '07700 900123' */
export function formatUkPhoneDisplay(
  e164: string | null | undefined,
): string {
  if (!e164 || !UK_E164_RE.test(e164)) return '';
  const nsn = e164.slice(3);
  return `0${nsn.slice(0, 4)} ${nsn.slice(4)}`;
}
