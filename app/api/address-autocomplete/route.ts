import { NextResponse } from 'next/server';
import { autocompleteAddress } from '@/lib/utils/places';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { input, sessionToken } = body;

    if (typeof input !== 'string' || !input.trim()) {
      return NextResponse.json({ suggestions: [] });
    }
    if (typeof sessionToken !== 'string' || !sessionToken.trim()) {
      return NextResponse.json({ error: 'sessionToken is required' }, { status: 400 });
    }

    const suggestions = await autocompleteAddress(input, sessionToken);
    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error('[api/address-autocomplete]', error);
    return NextResponse.json({ suggestions: [] }, { status: 500 });
  }
}
