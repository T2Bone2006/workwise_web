/**
 * A job-sheet cell that is a phone number, email or link is worth tapping. Deliberately strict:
 * the whole value has to be the thing, so an address or access note that happens to contain a
 * number never turns into a link. Mirrors detectFieldLink on the phone (workwise-mobile
 * src/lib/sourceFields.ts).
 */
export type FieldLink = { kind: 'tel' | 'mailto' | 'url'; href: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const URL_RE = /^(https?:\/\/|www\.)\S+$/i;
const PHONE_RE = /^(\+44\d{9,10}|0\d{9,10})$/;

export function detectFieldLink(value: string): FieldLink | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (EMAIL_RE.test(trimmed)) return { kind: 'mailto', href: `mailto:${trimmed}` };
  if (URL_RE.test(trimmed)) {
    return { kind: 'url', href: /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}` };
  }
  const digits = trimmed.replace(/[\s()\-.]/g, '');
  if (PHONE_RE.test(digits)) return { kind: 'tel', href: `tel:${digits}` };
  return null;
}

/** A tel: link for the customer's phone number as stored (any spacing), or null if it is not a UK number. */
export function telHref(phone: string | null | undefined): string | null {
  const link = phone ? detectFieldLink(phone) : null;
  return link?.kind === 'tel' ? link.href : null;
}

/** Google Maps search for an address; the worker taps it for directions. */
export function directionsHref(address: string | null, postcode: string | null): string | null {
  const query = [address, postcode].filter((p): p is string => !!p && p.trim().length > 0).join(', ');
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
}
