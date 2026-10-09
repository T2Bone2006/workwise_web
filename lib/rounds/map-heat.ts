import { heatWeight, type MapPlace } from '@/lib/rounds/map-areas';

/*
 * The maths behind the map's two heat styles. Everything here works in metres
 * on a flat local plane, so "about a kilometre" means a kilometre whatever the
 * zoom. Nothing in this file touches Leaflet or the DOM.
 */

export type XY = { x: number; y: number };
export type HeatMetric = 'money' | 'customers';

const EARTH_METRES = 6_371_008.8;
const RAD = Math.PI / 180;

/** Lat/lng to metres on a plane that is right near `refLat` (plenty for one trader's patch). */
export function makeProjection(refLat: number) {
  const k = Math.cos(refLat * RAD);
  return {
    project: (lat: number, lng: number): XY => ({ x: lng * RAD * EARTH_METRES * k, y: lat * RAD * EARTH_METRES }),
    unproject: (p: XY): [number, number] => [(p.y / EARTH_METRES) / RAD, (p.x / (EARTH_METRES * k)) / RAD],
  };
}

export type Projection = ReturnType<typeof makeProjection>;

export function centreLatitude(places: Pick<MapPlace, 'lat'>[]): number {
  if (places.length === 0) return 54;
  return places.reduce((sum, p) => sum + p.lat, 0) / places.length;
}

/* ---------- Glow ---------- */

export type DensityField = {
  /** How busy it is at this spot: each place adds a soft bump, closer means more. */
  at: (x: number, y: number) => number;
  /** The busiest any place's own spot gets. */
  peak: number;
  /** What the busiest tenth of places reach: the level that counts as "busy", so one hot spot can't wash out the rest. */
  busy: number;
};

/** Gaussian bumps of width `sigma` metres, one per point, summed. */
export function buildDensity(points: Array<XY & { w: number }>, sigma: number): DensityField {
  const cell = sigma * 3;
  // Numeric keys: this runs once per pixel block on every redraw.
  const keyOf = (cx: number, cy: number) => cx * 1_000_003 + cy;
  const buckets = new Map<number, Array<XY & { w: number }>>();
  for (const p of points) {
    const key = keyOf(Math.floor(p.x / cell), Math.floor(p.y / cell));
    const list = buckets.get(key);
    if (list) list.push(p);
    else buckets.set(key, [p]);
  }
  const twoSigmaSq = 2 * sigma * sigma;
  const reachSq = cell * cell;
  const at = (x: number, y: number): number => {
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    let sum = 0;
    for (let i = -1; i <= 1; i += 1) {
      for (let j = -1; j <= 1; j += 1) {
        const list = buckets.get(keyOf(cx + i, cy + j));
        if (!list) continue;
        for (const p of list) {
          const d2 = (p.x - x) ** 2 + (p.y - y) ** 2;
          if (d2 <= reachSq) sum += p.w * Math.exp(-d2 / twoSigmaSq);
        }
      }
    }
    return sum;
  };
  const atPlaces = points.map((p) => at(p.x, p.y)).sort((a, b) => a - b);
  const peak = atPlaces.length > 0 ? atPlaces[atPlaces.length - 1]! : 0;
  const busy = atPlaces.length > 0 ? atPlaces[Math.floor(0.9 * (atPlaces.length - 1))]! : 0;
  return { at, peak, busy };
}

type Stop = { t: number; rgb: [number, number, number]; a: number };

/** Green, then lime, yellow, orange, and ending in a deep red. */
const STOPS: Stop[] = [
  { t: 0, rgb: [34, 197, 94], a: 0 },
  { t: 0.1, rgb: [34, 197, 94], a: 0.42 },
  { t: 0.35, rgb: [163, 230, 53], a: 0.58 },
  { t: 0.55, rgb: [250, 204, 21], a: 0.7 },
  { t: 0.75, rgb: [249, 115, 22], a: 0.8 },
  { t: 0.9, rgb: [239, 68, 68], a: 0.88 },
  { t: 1, rgb: [185, 28, 28], a: 0.92 },
];

export type Rgba = { r: number; g: number; b: number; a: number };

/** Colour for 0 (quiet, clear) to 1 (busiest). */
export function rampColour(t: number): Rgba {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < STOPS.length; i += 1) {
    const hi = STOPS[i]!;
    if (x <= hi.t) {
      const lo = STOPS[i - 1]!;
      const f = hi.t === lo.t ? 0 : (x - lo.t) / (hi.t - lo.t);
      return {
        r: Math.round(lo.rgb[0] + (hi.rgb[0] - lo.rgb[0]) * f),
        g: Math.round(lo.rgb[1] + (hi.rgb[1] - lo.rgb[1]) * f),
        b: Math.round(lo.rgb[2] + (hi.rgb[2] - lo.rgb[2]) * f),
        a: lo.a + (hi.a - lo.a) * f,
      };
    }
  }
  const last = STOPS[STOPS.length - 1]!;
  return { r: last.rgb[0], g: last.rgb[1], b: last.rgb[2], a: last.a };
}

/** The same scale as a CSS gradient, for the legend bar. */
export const RAMP_CSS = `linear-gradient(to right, ${STOPS.filter((s) => s.t > 0)
  .map((s) => `rgb(${s.rgb.join(',')}) ${Math.round(s.t * 100)}%`)
  .join(', ')})`;

/* ---------- Reading a spot ---------- */

export type Around = { customers: number; yearly: number };

function sum(places: MapPlace[]): Around {
  return { customers: new Set(places.map((p) => p.customerId)).size, yearly: places.reduce((a, p) => a + p.yearly, 0) };
}

/** Everything within `metres` of a point: the hover read-out for the glow. */
export function aroundPoint(places: MapPlace[], project: Projection['project'], at: XY, metres: number): Around {
  const r2 = metres * metres;
  return sum(
    places.filter((p) => {
      const q = project(p.lat, p.lng);
      return (q.x - at.x) ** 2 + (q.y - at.y) ** 2 <= r2;
    }),
  );
}

/** One weight per place for the glow: money scales by the biggest place, customers count the same. */
export function glowPoints(places: MapPlace[], project: Projection['project'], metric: HeatMetric): Array<XY & { w: number }> {
  const maxYearly = Math.max(0, ...places.map((p) => p.yearly));
  return places.map((p) => ({ ...project(p.lat, p.lng), w: Math.max(0.15, heatWeight(p, metric, maxYearly)) }));
}
