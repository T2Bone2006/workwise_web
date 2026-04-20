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
    const clean = postcode.replace(/\s/g, '').toUpperCase();
    if (!clean.length) return null;
    let result = await lookup(clean);
    if (result) return result;
    // UK format: outcode + space + incode (e.g. SW1A 1AA). Try inserting space before last 3 chars.
    if (clean.length > 3) {
      const withSpace = `${clean.slice(0, -3)} ${clean.slice(-3)}`;
      result = await lookup(withSpace);
    }
    return result;
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
    const clean = postcode.replace(/\s/g, '').toUpperCase();
    if (!clean.length) return { valid: false };
    const normalized = clean.length > 3 ? `${clean.slice(0, -3)} ${clean.slice(-3)}` : clean;
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
