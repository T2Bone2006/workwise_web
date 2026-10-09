import { normalizeUkPostcode } from '@/lib/utils/postcode';

export type PostcodePoint = { lat: number; lng: number };

/**
 * Looks up many UK postcodes at once with postcodes.io's bulk endpoint (up to 100 per call).
 * Returns a map from the normalised postcode ("M3 2ER") to its position, or null when postcodes.io does not know it.
 * Throws when the service can't be reached, so the caller can fall back to one-by-one lookups
 * and never silently accepts a postcode it could not check.
 */
export async function lookupPostcodes(postcodes: ReadonlyArray<string>): Promise<Map<string, PostcodePoint | null>> {
  const normalised = [...new Set(postcodes.map((p) => normalizeUkPostcode(p)).filter((p): p is string => p !== null))];
  const out = new Map<string, PostcodePoint | null>();
  for (let i = 0; i < normalised.length; i += 100) {
    const batch = normalised.slice(i, i + 100);
    const response = await fetch('https://api.postcodes.io/postcodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postcodes: batch }),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`postcodes.io bulk lookup failed (${response.status})`);
    const body = (await response.json()) as {
      result?: Array<{ query: string; result: { latitude: number | null; longitude: number | null } | null }>;
    };
    for (const entry of body.result ?? []) {
      const key = normalizeUkPostcode(entry.query) ?? entry.query;
      const r = entry.result;
      out.set(
        key,
        r && typeof r.latitude === 'number' && typeof r.longitude === 'number' ? { lat: r.latitude, lng: r.longitude } : null,
      );
    }
    for (const asked of batch) if (!out.has(asked)) out.set(asked, null);
  }
  return out;
}
