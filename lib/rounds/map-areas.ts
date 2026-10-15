/*
 * Pure helpers for the Rounds map: which pin colour, the outline around the
 * whole patch, and the numbers in the side panel for whatever is on screen.
 */

export type LatLng = [number, number];

export type MapBounds = { south: number; west: number; north: number; east: number };

export type MapPlace = {
  /** The agreement (one property on one cycle). */
  id: string;
  customerId: string;
  customerName: string;
  title: string;
  address: string;
  postcode: string;
  lat: number;
  lng: number;
  /** What this place brings in over a year at today's price. */
  yearly: number;
  /** Visits booked this calendar month, skipped ones left out. */
  visitsThisMonth: number;
  /** Has a visit this week that is not done yet. */
  dueThisWeek: boolean;
  /** The customer owes money. True on every place of that customer, for the pin colour. */
  owes: boolean;
  /** What the customer owes, on their first place only, so panel totals count it once. */
  owed: number;
  /** Price of one visit. */
  price: number;
  /** "Every 4 weeks", for the customer card. */
  frequencyLabel: string;
  /** The next visit still to do, if one is booked. */
  nextVisit: string | null;
  phone: string | null;
  /** The named round this place is in, if any. */
  roundId: string | null;
};

export type PinState = 'owes' | 'due' | 'fine';

export type HeatMode = 'off' | 'money' | 'customers';

export const PIN_COLOURS: Record<PinState, { fill: string; stroke: string; label: string }> = {
  owes: { fill: '#e11d48', stroke: '#9f1239', label: 'Owes money' },
  due: { fill: '#f59e0b', stroke: '#b45309', label: 'Due this week' },
  fine: { fill: '#0c66e4', stroke: '#0369a1', label: 'All fine' },
};

export function pinState(place: Pick<MapPlace, 'owes' | 'dueThisWeek'>): PinState {
  if (place.owes) return 'owes';
  if (place.dueThisWeek) return 'due';
  return 'fine';
}

export type MapStats = {
  customers: number;
  yearly: number;
  visitsThisMonth: number;
  owed: number;
};

export function summarisePlaces(places: MapPlace[]): MapStats {
  const customers = new Set<string>();
  let yearly = 0;
  let visitsThisMonth = 0;
  let owed = 0;
  for (const place of places) {
    customers.add(place.customerId);
    yearly += place.yearly;
    visitsThisMonth += place.visitsThisMonth;
    owed += place.owed;
  }
  return { customers: customers.size, yearly, visitsThisMonth, owed };
}

export function placesInBounds(places: MapPlace[], b: MapBounds): MapPlace[] {
  return places.filter((p) => p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east);
}

function cross(o: LatLng, a: LatLng, b: LatLng): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** Smallest convex shape around the points (Andrew's monotone chain). */
export function convexHull(points: LatLng[]): LatLng[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const lower: LatLng[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: LatLng[] = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const p = sorted[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

const METRES_PER_DEGREE = 111_320;
const RING_POINTS = 12;

/**
 * A shape around all the points with `marginMetres` to spare on every side:
 * the hull of a small ring around each point, so one customer or two still
 * get a sensible outline.
 */
export function outlineAround(points: LatLng[], marginMetres: number): LatLng[] {
  if (points.length === 0) return [];
  const rings: LatLng[] = [];
  for (const [lat, lng] of points) {
    const dLat = marginMetres / METRES_PER_DEGREE;
    const dLng = marginMetres / (METRES_PER_DEGREE * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
    for (let i = 0; i < RING_POINTS; i += 1) {
      const angle = (2 * Math.PI * i) / RING_POINTS;
      rings.push([lat + dLat * Math.sin(angle), lng + dLng * Math.cos(angle)]);
    }
  }
  return convexHull(rings);
}

/** 0 to 1: how much of the busiest place's yearly value this place has. */
export function heatWeight(place: MapPlace, mode: 'money' | 'customers', maxYearly: number): number {
  if (mode === 'customers') return 1;
  if (maxYearly <= 0) return 0;
  return Math.min(1, Math.max(0, place.yearly / maxYearly));
}
