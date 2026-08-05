import { postcodeToLatLng } from './postcode';

type LatLng = { lat: number; lng: number };

function buildGoogleGeocodingUrl(address: string, apiKey: string): string {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('key', apiKey);
  return url.toString();
}

export function buildFullAddressString(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => part?.trim() ?? '')
    .filter((part) => part.length > 0)
    .join(', ');
}

/**
 * Resolves coordinates for a job, preferring the free postcodes.io lookup and
 * falling back to Google only when it can't answer.
 *
 * postcodes.io is free, unlimited, needs no API key and uses ONS data, so it
 * can't break from an expired key or lapsed billing — which is exactly how
 * every job ended up with null coordinates previously. Google is kept as a
 * fallback because postcodes.io returns nothing for a missing or malformed
 * postcode, and it resolves to a building rather than a postcode centroid.
 */
export async function resolveJobCoordinates(params: {
  postcode?: string | null;
  fullAddress?: string | null;
}): Promise<LatLng | null> {
  const postcode = params.postcode?.trim();
  if (postcode) {
    const fromPostcode = await postcodeToLatLng(postcode);
    if (fromPostcode) return fromPostcode;
  }

  const fullAddress = params.fullAddress?.trim();
  if (fullAddress) {
    return geocodeAddress(fullAddress);
  }

  return null;
}

export async function geocodeAddress(address: string): Promise<LatLng | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  const normalizedAddress = address.trim();

  if (!apiKey || !normalizedAddress) return null;

  try {
    const response = await fetch(buildGoogleGeocodingUrl(normalizedAddress, apiKey), {
      method: 'GET',
    });
    if (!response.ok) return null;

    const data = (await response.json()) as {
      status?: string;
      results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }>;
      error_message?: string;
    };

    if (data.status !== 'OK' || !data.results?.length) {
      if (data.error_message) {
        console.error('[geocodeAddress] Google Geocoding API error:', data.error_message);
      }
      return null;
    }

    const location = data.results[0]?.geometry?.location;
    if (typeof location?.lat !== 'number' || typeof location?.lng !== 'number') {
      return null;
    }

    return { lat: location.lat, lng: location.lng };
  } catch (error) {
    console.error('[geocodeAddress] failed:', error);
    return null;
  }
}
