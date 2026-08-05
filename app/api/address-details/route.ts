import { NextResponse } from 'next/server';
import { getPlaceAddressDetails } from '@/lib/utils/places';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { placeId, sessionToken } = body;

    if (typeof placeId !== 'string' || !placeId.trim()) {
      return NextResponse.json({ error: 'placeId is required' }, { status: 400 });
    }
    if (typeof sessionToken !== 'string' || !sessionToken.trim()) {
      return NextResponse.json({ error: 'sessionToken is required' }, { status: 400 });
    }

    const details = await getPlaceAddressDetails(placeId, sessionToken);
    if (!details) {
      return NextResponse.json({ error: 'Could not resolve address details' }, { status: 502 });
    }

    return NextResponse.json(details);
  } catch (error) {
    console.error('[api/address-details]', error);
    return NextResponse.json({ error: 'Failed to look up address' }, { status: 500 });
  }
}
