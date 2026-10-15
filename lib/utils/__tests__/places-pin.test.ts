import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addressFromGeocode, lookupPin } from '@/lib/utils/places';

describe('addressFromGeocode', () => {
  it('builds the street line and finds the postcode', () => {
    expect(
      addressFromGeocode([
        { long_name: '12', types: ['street_number'] },
        { long_name: 'Elm Road', types: ['route'] },
        { long_name: 'Manchester', types: ['postal_town'] },
        { long_name: 'M3 2ER', types: ['postal_code'] },
      ]),
    ).toEqual({ address: '12 Elm Road, Manchester', postcode: 'M3 2ER' });
  });

  it('copes with a road and no house number', () => {
    expect(addressFromGeocode([{ long_name: 'Elm Road', types: ['route'] }, { long_name: 'Leeds', types: ['locality'] }])).toEqual({
      address: 'Elm Road, Leeds',
      postcode: '',
    });
  });
});

describe('lookupPin', () => {
  const realKey = process.env.GOOGLE_MAPS_API_KEY;
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    if (realKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = realKey;
  });

  it('with no Google key, uses the nearest postcode and says the pin is near it', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ result: [{ postcode: 'M3 2ER' }] }))),
    );
    expect(await lookupPin(53.48, -2.24)).toEqual({ address: 'Pin near M3 2ER', postcode: 'M3 2ER', exact: false });
  });

  it('uses the street address Google finds', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            status: 'OK',
            results: [
              {
                address_components: [
                  { long_name: '12', types: ['street_number'] },
                  { long_name: 'Elm Road', types: ['route'] },
                  { long_name: 'Manchester', types: ['postal_town'] },
                  { long_name: 'M3 2ER', types: ['postal_code'] },
                ],
              },
            ],
          }),
        ),
      ),
    );
    expect(await lookupPin(53.48, -2.24)).toEqual({ address: '12 Elm Road, Manchester', postcode: 'M3 2ER', exact: true });
  });

  it('falls back to the nearest postcode when Google has a street but no postcode', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('googleapis')
        ? new Response(JSON.stringify({ status: 'OK', results: [{ address_components: [{ long_name: 'Elm Road', types: ['route'] }] }] }))
        : new Response(JSON.stringify({ result: [{ postcode: 'M3 2ER' }] })),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(await lookupPin(53.48, -2.24)).toEqual({ address: 'Elm Road', postcode: 'M3 2ER', exact: true });
  });

  it('gives up when there is no postcode nearby (the sea)', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ result: null }))));
    expect(await lookupPin(54.5, -4.9)).toBeNull();
  });
});
