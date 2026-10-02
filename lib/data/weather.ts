import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { getRoundsSettings } from '@/lib/data/rounds/settings';
import { postcodeToLatLng } from '@/lib/utils/postcode';
import { summariseForecast, type WeatherByDay } from '@/lib/weather/met-norway';

type Point = { lat: number | null; lng: number | null };

/** 2 decimals is about 1 km: neighbouring businesses share one cached forecast, and MET allows at most 4. */
const round2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

function middleOf(points: Point[]): { lat: number; lng: number } | null {
  const located = points.filter((p): p is { lat: number; lng: number } => p.lat != null && p.lng != null);
  if (located.length === 0) return null;
  return {
    lat: located.reduce((sum, p) => sum + p.lat, 0) / located.length,
    lng: located.reduce((sum, p) => sum + p.lng, 0) / located.length,
  };
}

/** Recent visits with coordinates, for a day that has none of its own (an empty day, no start postcode). */
async function recentVisitPoints(db: SupabaseClient, tenantId: string): Promise<Point[]> {
  const { data, error } = await db
    .from('jobs')
    .select('lat, lng')
    .eq('tenant_id', tenantId)
    .not('lat', 'is', null)
    .not('lng', 'is', null)
    .order('scheduled_date', { ascending: false })
    .limit(50);
  if (error) return [];
  return (data ?? []) as Point[];
}

/** The start postcode, else the middle of the visits on screen, else the middle of recent visits, else nowhere. */
async function placeFor(
  db: SupabaseClient,
  tenantId: string,
  settingsPostcode: string | null,
  visitPoints: Point[],
): Promise<{ lat: number; lng: number } | null> {
  if (settingsPostcode) {
    const found = await postcodeToLatLng(settingsPostcode);
    if (found) return found;
  }
  return middleOf(visitPoints) ?? middleOf(await recentVisitPoints(db, tenantId));
}

/**
 * The next 9 days of weather for one Rounds business, from MET Norway (free,
 * commercial use allowed; they ask for an identifying User-Agent, caching and a
 * credit on screen). Information only. Any failure returns null so the page shows
 * exactly what it did before, with no error.
 */
export async function loadWeather(
  db: SupabaseClient,
  p: { tenantId: string; visitPoints?: Point[] },
): Promise<WeatherByDay | null> {
  const contact = process.env.SETUP_REQUEST_EMAIL;
  if (!contact) return null;

  try {
    const settings = await getRoundsSettings(db, p.tenantId);
    const place = await placeFor(db, p.tenantId, settings.start_postcode, p.visitPoints ?? []);
    if (!place) return null;

    const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${round2(place.lat)}&lon=${round2(place.lng)}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': `WorkWise/1.0 (${contact})` },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return null;

    const days = summariseForecast(await response.json());
    return days.length > 0 ? Object.fromEntries(days.map((d) => [d.date, d])) : null;
  } catch (err) {
    console.error('[loadWeather]', err instanceof Error ? err.message : 'failed');
    return null;
  }
}
