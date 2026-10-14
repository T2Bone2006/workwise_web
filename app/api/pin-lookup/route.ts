import { NextResponse } from 'next/server';
import { getOwnerTenantId } from '@/lib/auth/require-owner';
import { lookupPin } from '@/lib/utils/places';
import { pinLatSchema, pinLngSchema } from '@/lib/validations/rounds/agreement';

/** The address and postcode for a spot dropped on the map. Signed-in traders only (it uses the Google key). */
export async function POST(req: Request) {
  const tenantId = await getOwnerTenantId();
  if (!tenantId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  try {
    const body = await req.json();
    const lat = pinLatSchema.safeParse(body?.lat);
    const lng = pinLngSchema.safeParse(body?.lng);
    if (!lat.success || !lng.success || lat.data == null || lng.data == null) {
      return NextResponse.json({ error: 'That spot is outside the UK.' }, { status: 400 });
    }

    const found = await lookupPin(lat.data, lng.data);
    if (!found) {
      return NextResponse.json(
        { error: "Couldn't find a UK postcode there. Move the pin onto land." },
        { status: 404 },
      );
    }
    return NextResponse.json(found);
  } catch (error) {
    console.error('[api/pin-lookup]', error);
    return NextResponse.json({ error: 'Failed to look up that spot' }, { status: 500 });
  }
}
