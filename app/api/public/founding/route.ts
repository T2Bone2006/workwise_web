import { NextResponse } from 'next/server';
import { getFoundingStatus } from '@/lib/billing/offers';

export async function GET() {
  const { active, placesLeft, places } = await getFoundingStatus();
  return NextResponse.json(
    { active, placesLeft, places },
    { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=600' } }
  );
}
