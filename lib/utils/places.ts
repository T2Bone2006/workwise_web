/**
 * Google Places API (New) — address autocomplete for job creation.
 *
 * Uses session tokens so a full "type a few characters, then pick a result"
 * flow bills as a single session rather than one charge per keystroke plus a
 * separate details charge. The token must be generated client-side and
 * reused across every autocomplete keystroke and the final details call,
 * then discarded once a selection is made.
 */

const PLACES_API_BASE = 'https://places.googleapis.com/v1';

export type PlaceSuggestion = {
  placeId: string;
  text: string;
};

export type PlaceAddressDetails = {
  address: string;
  postcode: string;
  /** Where Google puts the place. Used to centre the pin map on a searched address. */
  lat?: number;
  lng?: number;
};

type AutocompleteApiResponse = {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
    };
  }>;
};

export async function autocompleteAddress(
  input: string,
  sessionToken: string
): Promise<PlaceSuggestion[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!apiKey || !input.trim()) return [];

  try {
    const response = await fetch(`${PLACES_API_BASE}/places:autocomplete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
      },
      body: JSON.stringify({
        input,
        sessionToken,
        includedRegionCodes: ['gb'],
      }),
    });

    if (!response.ok) {
      console.error('[autocompleteAddress] request failed', response.status, await response.text());
      return [];
    }

    const data = (await response.json()) as AutocompleteApiResponse;
    const suggestions = data.suggestions ?? [];

    return suggestions
      .map((s) => ({
        placeId: s.placePrediction?.placeId ?? '',
        text: s.placePrediction?.text?.text ?? '',
      }))
      .filter((s) => s.placeId && s.text);
  } catch (error) {
    console.error('[autocompleteAddress] failed:', error);
    return [];
  }
}

type AddressComponent = {
  longText?: string;
  types?: string[];
};

type PlaceDetailsApiResponse = {
  formattedAddress?: string;
  addressComponents?: AddressComponent[];
  location?: { latitude?: number; longitude?: number };
};

/**
 * "Premise"/building-name results (common in this dataset — addresses like
 * "Flat 14 William Saville House Denmark Road" lead with a building name) can
 * come back from Places with no `postal_code` component at all. When that
 * happens, resolve the postcode by reverse-looking-up the place's
 * coordinates via postcodes.io — free, no key, and it's the nearest real UK
 * postcode rather than a guess.
 */
async function reverseGeocodePostcode(lat: number, lng: number): Promise<string> {
  try {
    const response = await fetch(
      `https://api.postcodes.io/postcodes?lon=${lng}&lat=${lat}&limit=1`
    );
    if (!response.ok) return '';
    const data = await response.json();
    return data?.result?.[0]?.postcode ?? '';
  } catch {
    return '';
  }
}

function hasType(component: AddressComponent, type: string): boolean {
  return component.types?.includes(type) ?? false;
}

export async function getPlaceAddressDetails(
  placeId: string,
  sessionToken: string
): Promise<PlaceAddressDetails | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!apiKey || !placeId.trim()) return null;

  try {
    const url = new URL(`${PLACES_API_BASE}/places/${encodeURIComponent(placeId)}`);
    url.searchParams.set('sessionToken', sessionToken);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'formattedAddress,addressComponents,location',
      },
    });

    if (!response.ok) {
      console.error('[getPlaceAddressDetails] request failed', response.status, await response.text());
      return null;
    }

    const data = (await response.json()) as PlaceDetailsApiResponse;
    const components = data.addressComponents ?? [];

    let postcode = components.find((c) => hasType(c, 'postal_code'))?.longText ?? '';
    if (!postcode && data.location?.latitude != null && data.location?.longitude != null) {
      postcode = await reverseGeocodePostcode(data.location.latitude, data.location.longitude);
    }

    // Build the address line from components rather than using
    // formattedAddress directly, so the postcode isn't duplicated between
    // the address text and the separate postcode field.
    const streetNumber = components.find((c) => hasType(c, 'street_number'))?.longText;
    const route = components.find((c) => hasType(c, 'route'))?.longText;
    const subpremise = components.find((c) => hasType(c, 'subpremise'))?.longText;
    const locality =
      components.find((c) => hasType(c, 'postal_town'))?.longText ??
      components.find((c) => hasType(c, 'locality'))?.longText;

    const addressLine = [
      [subpremise, streetNumber, route].filter(Boolean).join(' '),
      locality,
    ]
      .filter((part) => part && part.trim().length > 0)
      .join(', ');

    return {
      address: addressLine || data.formattedAddress || '',
      postcode,
      ...(data.location?.latitude != null && data.location?.longitude != null
        ? { lat: data.location.latitude, lng: data.location.longitude }
        : {}),
    };
  } catch (error) {
    console.error('[getPlaceAddressDetails] failed:', error);
    return null;
  }
}

type GeocodeComponent = { long_name?: string; types?: string[] };

/** The street line and postcode out of a Google Geocoding result's components. */
export function addressFromGeocode(components: GeocodeComponent[]): { address: string; postcode: string } {
  const find = (type: string) => components.find((c) => c.types?.includes(type))?.long_name ?? '';
  const street = [find('subpremise'), find('street_number'), find('route')].filter(Boolean).join(' ');
  const town = find('postal_town') || find('locality');
  return {
    address: [street, town].filter((part) => part.trim()).join(', '),
    postcode: find('postal_code'),
  };
}

export type PinLookup = { address: string; postcode: string; exact: boolean };

/**
 * Works out the address for a spot dropped on the map. The postcode comes from
 * Google when it has one, else from the nearest postcode on postcodes.io (free,
 * no key). The street line only comes from Google; without it the address reads
 * "Pin near M3 2ER" so the required field is never empty, and the trader can
 * retype it. `exact` is true when a real street address was found.
 */
export async function lookupPin(lat: number, lng: number): Promise<PinLookup | null> {
  let address = '';
  let postcode = '';

  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (apiKey) {
    try {
      const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
      url.searchParams.set('latlng', `${lat},${lng}`);
      url.searchParams.set('result_type', 'street_address|premise|subpremise|route');
      url.searchParams.set('key', apiKey);
      const response = await fetch(url.toString());
      if (response.ok) {
        const data = (await response.json()) as {
          status?: string;
          results?: Array<{ address_components?: GeocodeComponent[] }>;
        };
        if (data.status === 'OK') {
          for (const result of data.results ?? []) {
            const found = addressFromGeocode(result.address_components ?? []);
            if (found.address) {
              address = found.address;
              postcode = found.postcode;
              break;
            }
          }
        }
      }
    } catch (error) {
      console.error('[lookupPin] google failed:', error);
    }
  }

  if (!postcode) {
    try {
      const response = await fetch(
        `https://api.postcodes.io/postcodes?lon=${lng}&lat=${lat}&limit=1&radius=500`
      );
      if (response.ok) {
        const data = await response.json();
        postcode = data?.result?.[0]?.postcode ?? '';
      }
    } catch {
      // handled below: no postcode, no answer
    }
  }

  if (!postcode) return null;
  return address
    ? { address, postcode, exact: true }
    : { address: `Pin near ${postcode}`, postcode, exact: false };
}
