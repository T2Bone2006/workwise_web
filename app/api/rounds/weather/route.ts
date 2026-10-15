import { NextResponse } from 'next/server';
import { requireRoundsApi } from '@/lib/api/rounds-request';
import { loadWeather } from '@/lib/data/weather';

/** The next 9 days of forecast for this business. Empty when there is no place or MET is down. */
export async function GET(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const weather = await loadWeather(auth.ctx.supabase, { tenantId: auth.ctx.tenantId });
  const days = weather
    ? Object.values(weather).map((day) => ({
        date: day.date,
        symbol: day.symbol,
        label: day.label,
        highC: day.highC,
        wet: day.wet,
      }))
    : [];

  return NextResponse.json(
    { days },
    { headers: { 'Cache-Control': 'private, max-age=1800' } },
  );
}
