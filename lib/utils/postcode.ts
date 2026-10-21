/** Valid UK postcode without spaces (M3, BL3, WN1, SW1A, etc.). */
const UK_POSTCODE_REGEX = /^[A-Z]{1,2}\d{1,2}[A-Z]?\d[A-Z]{2}$/;

/**
 * First part of a UK postcode (the outward code). Falls back to the text
 * before the first space when the value is not a full postcode.
 */
export function ukPostcodeOutward(raw: string): string {
  const trimmed = raw.trim().toUpperCase();
  if (!trimmed) return '';
  const compact = trimmed.replace(/\s+/g, '');
  const full = compact.match(/^([A-Z]{1,2}\d{1,2}[A-Z]?)(\d[A-Z]{2})$/);
  if (full) return full[1]!;
  const head = trimmed.split(/\s+/)[0] ?? '';
  return head;
}

/** True when `postcode` sits in an area described by `area` (outward code or a shorter prefix such as SW). */
export function postcodeMatchesArea(postcode: string, area: string): boolean {
  const token = area.trim().toUpperCase().replace(/\s+/g, '');
  if (!token) return false;
  const outward = ukPostcodeOutward(postcode);
  const compact = postcode.trim().toUpperCase().replace(/\s+/g, '');
  return outward === token || outward.startsWith(token) || compact.startsWith(token);
}

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
  // A postcode's coordinates don't move, and the overview and calendar ask on every load.
  const response = await fetch(`https://api.postcodes.io/postcodes/${postcode}`, {
    next: { revalidate: 60 * 60 * 24 * 30 },
    signal: AbortSignal.timeout(3000),
  });
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

/**
 * Many postcodes at once (postcodes.io bulk lookup, 100 per request). Returns
 * a map from the normalised postcode ("BS7 8AA") to its centre; postcodes it
 * can't place are simply missing. Never throws.
 */
export async function postcodesToLatLng(postcodes: string[]): Promise<Map<string, { lat: number; lng: number }>> {
  const out = new Map<string, { lat: number; lng: number }>();
  const wanted = [...new Set(postcodes.map((p) => normalizeUkPostcode(p)).filter((p): p is string => p != null))];
  for (let i = 0; i < wanted.length; i += 100) {
    const batch = wanted.slice(i, i + 100);
    try {
      const response = await fetch('https://api.postcodes.io/postcodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postcodes: batch }),
        signal: AbortSignal.timeout(6000),
      });
      if (!response.ok) continue;
      const body = (await response.json()) as {
        result?: Array<{ query?: string; result?: { latitude?: number; longitude?: number } | null }>;
      };
      for (const row of body.result ?? []) {
        const lat = row.result?.latitude;
        const lng = row.result?.longitude;
        const key = row.query ? normalizeUkPostcode(row.query) : null;
        if (key && typeof lat === 'number' && typeof lng === 'number') out.set(key, { lat, lng });
      }
    } catch (error) {
      console.error('Bulk postcode lookup failed:', error);
    }
  }
  return out;
}

/**
 * The centre of each postcode area ("M14" from "M14 5TY"), for postcodes the
 * full lookup can't place (new builds, typos, made-up test data). One request
 * per area. Never throws.
 */
export async function outcodesToLatLng(postcodes: string[]): Promise<Map<string, { lat: number; lng: number }>> {
  const out = new Map<string, { lat: number; lng: number }>();
  const outcodes = [...new Set(postcodes.map((p) => normalizeUkPostcode(p)?.split(' ')[0] ?? p.trim().split(/\s+/)[0]?.toUpperCase()).filter((p): p is string => Boolean(p)))];
  await Promise.all(
    outcodes.slice(0, 20).map(async (code) => {
      try {
        const response = await fetch(`https://api.postcodes.io/outcodes/${encodeURIComponent(code)}`, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) return;
        const body = (await response.json()) as { result?: { latitude?: number; longitude?: number } | null };
        const lat = body.result?.latitude;
        const lng = body.result?.longitude;
        if (typeof lat === 'number' && typeof lng === 'number') out.set(code, { lat, lng });
      } catch (error) {
        console.error('Outcode lookup failed:', error);
      }
    }),
  );
  return out;
}
