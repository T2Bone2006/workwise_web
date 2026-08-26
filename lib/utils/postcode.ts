/** Valid UK postcode without spaces (M3, BL3, WN1, SW1A, etc.). */
const UK_POSTCODE_REGEX = /^[A-Z]{1,2}\d{1,2}[A-Z]?\d[A-Z]{2}$/;

/** UK postcode token inside free text (outward + inward). */
const UK_POSTCODE_IN_TEXT =
  /\b([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})\b/gi;

/**
 * Normalise a UK postcode to standard format (e.g. M3 2ER). Returns null if invalid.
 */
export function normalizeUkPostcode(raw: string): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const clean = trimmed.replace(/\s+/g, '').toUpperCase();
  if (!UK_POSTCODE_REGEX.test(clean)) return null;
  const match = clean.match(/^([A-Z]{1,2}\d{1,2}[A-Z]?)(\d[A-Z]{2})$/);
  return match ? `${match[1]} ${match[2]}` : null;
}

/**
 * Light cleanup before normalise: strip parentheticals, dots/hyphens as separators.
 * Does not invent a postcode — only reshapes the candidate string.
 */
export function coerceUkPostcodeCandidate(raw: string): string {
  let s = raw.trim();
  if (!s) return '';
  const beforeParen = s.split('(')[0];
  if (beforeParen != null) s = beforeParen.trim();
  s = s.replace(/[.,;:]+$/g, '').trim();
  s = s.replace(/-/g, ' ').replace(/\./g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Find a UK postcode inside an address (or other) string. Prefers the last match
 * (usually at the end of a UK address line).
 */
export function extractUkPostcodeFromText(text: string): string | null {
  if (!text?.trim()) return null;
  const matches = [...text.toUpperCase().matchAll(UK_POSTCODE_IN_TEXT)];
  if (matches.length === 0) return null;
  for (let i = matches.length - 1; i >= 0; i--) {
    const candidate = matches[i]![1]!;
    const normalized = normalizeUkPostcode(candidate);
    if (normalized) return normalized;
  }
  return null;
}

/**
 * Resolve postcode from mapped cell and/or address without AI.
 * Order: normalise cell → coerce cell → extract from address.
 */
export function resolvePostcodeDeterministic(
  rawPostcode: string,
  address: string
): string | null {
  const direct = normalizeUkPostcode(rawPostcode);
  if (direct) return direct;

  if (rawPostcode.trim()) {
    const coerced = normalizeUkPostcode(coerceUkPostcodeCandidate(rawPostcode));
    if (coerced) return coerced;
    const fromRaw = extractUkPostcodeFromText(rawPostcode);
    if (fromRaw) return fromRaw;
  }

  return extractUkPostcodeFromText(address);
}

// Convert UK postcode to lat/lng using free postcodes.io API
async function lookup(postcode: string): Promise<{ lat: number; lng: number } | null> {
  const response = await fetch(`https://api.postcodes.io/postcodes/${postcode}`);
  if (!response.ok) return null;
  const data = await response.json();
  if (data.status === 200 && data.result) {
    return { lat: data.result.latitude, lng: data.result.longitude };
  }
  return null;
}

export async function postcodeToLatLng(postcode: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const normalized = normalizeUkPostcode(postcode);
    if (!normalized) return null;
    const compact = normalized.replace(/\s/g, '');
    let result = await lookup(compact);
    if (result) return result;
    return await lookup(normalized);
  } catch (error) {
    console.error('Postcode lookup failed:', error);
    return null;
  }
}

/** Result from postcodes.io for UI display (valid postcode + location string) */
export type PostcodeValidationResult =
  | { valid: true; postcode: string; location: string }
  | { valid: false };

/**
 * Validate UK postcode via postcodes.io (call from client or server).
 * Returns validation result with location string for display (e.g. "SW1A 1AA, Westminster").
 */
export async function validatePostcode(
  postcode: string
): Promise<PostcodeValidationResult> {
  try {
    const normalized = normalizeUkPostcode(postcode);
    if (!normalized) return { valid: false };
    const response = await fetch(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(normalized)}`
    );
    const data = await response.json();
    if (data.status !== 200 || !data.result) return { valid: false };
    const r = data.result;
    const location = [r.admin_ward, r.admin_district, r.region]
      .filter(Boolean)
      .join(', ') || r.postcode;
    return {
      valid: true,
      postcode: r.postcode,
      location: `${r.postcode}${location ? `, ${location}` : ''}`,
    };
  } catch {
    return { valid: false };
  }
}
