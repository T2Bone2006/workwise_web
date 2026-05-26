/** Valid UK postcode without spaces (M3, BL3, WN1, SW1A, etc.). */
const UK_POSTCODE_REGEX = /^[A-Z]{1,2}\d{1,2}[A-Z]?\d[A-Z]{2}$/;

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
