import type { SupabaseClient } from '@supabase/supabase-js';
import { getRoundsSettings } from '@/lib/data/rounds/settings';
import { isValidYmd, type Ymd } from '@/lib/rounds/dates';
import { getSoloWorkerForTenant } from '@/lib/rounds/rounds-worker';
import { optimiseRoute, type RoutePoint } from '@/lib/rounds/route-optimiser';
import { RESCHEDULE_STATUSES, reorderDayCore } from '@/lib/rounds/visit-transitions';
import { postcodeToLatLng } from '@/lib/utils/postcode';

export type OptimisedStop = {
  jobId: string;
  position: number;
  address: string;
  postcode: string;
  lat: number | null;
  lng: number | null;
};

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Saved route-start postcode, else the solo worker's home pin. */
async function resolveHome(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<RoutePoint | null> {
  const settings = await getRoundsSettings(supabase, tenantId);
  if (settings.start_postcode) {
    const geocoded = await postcodeToLatLng(settings.start_postcode);
    if (geocoded) return geocoded;
  }
  const solo = await getSoloWorkerForTenant(supabase, tenantId);
  if (solo?.home_lat != null && solo.home_lng != null) {
    return { lat: solo.home_lat, lng: solo.home_lng };
  }
  return null;
}

async function resolvePoint(
  overridePostcode: string | null | undefined,
  home: RoutePoint | null,
  missingLabel: string,
): Promise<
  | { ok: true; point: RoutePoint | null }
  | { ok: false; error: string }
> {
  const override = overridePostcode?.trim();
  if (!override) return { ok: true, point: home };
  const geocoded = await postcodeToLatLng(override);
  if (!geocoded) {
    return { ok: false, error: missingLabel };
  }
  return { ok: true, point: geocoded };
}

export async function optimiseDayCore(
  supabase: SupabaseClient,
  params: {
    tenantId: string;
    date: Ymd;
    persist: boolean;
    /** This run only. Does not rewrite the saved route start. */
    startPostcode?: string | null;
    /** This run only. Defaults to home (the saved route start). */
    finishPostcode?: string | null;
  },
): Promise<
  | {
      success: true;
      stops: OptimisedStop[];
      distanceKm: number;
      start: RoutePoint | null;
      finish: RoutePoint | null;
    }
  | { success: false; error: string }
> {
  if (!isValidYmd(params.date)) {
    return { success: false, error: 'Pick a valid date.' };
  }

  const home = await resolveHome(supabase, params.tenantId);
  const resolvedStart = await resolvePoint(
    params.startPostcode,
    home,
    'Could not find that postcode.',
  );
  if (!resolvedStart.ok) return { success: false, error: resolvedStart.error };
  const resolvedFinish = await resolvePoint(
    params.finishPostcode,
    home,
    'Could not find that finish postcode.',
  );
  if (!resolvedFinish.ok) return { success: false, error: resolvedFinish.error };
  const start = resolvedStart.point;
  const finish = resolvedFinish.point;
  const { data, error } = await supabase
    .from('jobs')
    .select('id, address, postcode, lat, lng, route_position, scheduled_time, created_at')
    .eq('tenant_id', params.tenantId)
    .eq('scheduled_date', params.date)
    .in('status', [...RESCHEDULE_STATUSES]);

  if (error) {
    return { success: false, error: error.message ?? 'Failed to load stops.' };
  }

  const jobs = (data ?? []).map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      id: typeof row.id === 'string' ? row.id : '',
      address: typeof row.address === 'string' ? row.address : '',
      postcode: typeof row.postcode === 'string' ? row.postcode : '',
      lat: asFiniteNumber(row.lat),
      lng: asFiniteNumber(row.lng),
    };
  }).filter((job) => job.id !== '');

  const { order, distanceKm } = optimiseRoute(
    start,
    jobs.map((job) => ({ id: job.id, lat: job.lat, lng: job.lng })),
    finish,
  );
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const stops: OptimisedStop[] = order.map((jobId, index) => {
    const job = byId.get(jobId);
    return {
      jobId,
      position: index + 1,
      address: job?.address ?? '',
      postcode: job?.postcode ?? '',
      lat: job?.lat ?? null,
      lng: job?.lng ?? null,
    };
  });

  if (params.persist && stops.length > 0) {
    const saved = await reorderDayCore(supabase, {
      tenantId: params.tenantId,
      date: params.date,
      orderedJobIds: order,
    });
    if (!saved.success) return saved;
  }

  return { success: true, stops, distanceKm, start, finish };
}
