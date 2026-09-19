import { haversineDistance } from '@/lib/utils/haversine';

export type RoutePoint = { lat: number; lng: number };
export type RouteStop = { id: string; lat: number | null; lng: number | null };

const TWO_OPT_MAX_PASSES = 200;
const IMPROVEMENT_EPS = 1e-9;

type GeoStop = { id: string; lat: number; lng: number };

function hasCoords(stop: RouteStop): stop is GeoStop {
  return stop.lat != null && stop.lng != null;
}

export function routeDistanceKm(
  start: RoutePoint | null,
  orderedStops: RoutePoint[],
): number {
  if (orderedStops.length === 0) return 0;

  let distance = 0;
  let prev: RoutePoint | null = start;

  for (const stop of orderedStops) {
    if (prev) {
      distance += haversineDistance(prev.lat, prev.lng, stop.lat, stop.lng);
    }
    prev = stop;
  }

  return distance;
}

function nearestIndex(current: RoutePoint, remaining: GeoStop[]): number {
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < remaining.length; i++) {
    const stop = remaining[i];
    const distance = haversineDistance(
      current.lat,
      current.lng,
      stop.lat,
      stop.lng,
    );
    // Strict < keeps the earlier remaining stop on a tie (input order).
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function nearestNeighbour(
  start: RoutePoint | null,
  stops: GeoStop[],
): GeoStop[] {
  if (stops.length === 0) return [];

  const remaining = stops.slice();
  const order: GeoStop[] = [];

  let current: RoutePoint;
  if (start) {
    current = start;
  } else {
    const first = remaining.shift()!;
    order.push(first);
    current = first;
  }

  while (remaining.length > 0) {
    const next = remaining.splice(nearestIndex(current, remaining), 1)[0];
    order.push(next);
    current = next;
  }

  return order;
}

function reverseSegment<T>(items: T[], from: number, to: number): T[] {
  const next = items.slice();
  let i = from;
  let j = to;
  while (i < j) {
    const tmp = next[i];
    next[i] = next[j];
    next[j] = tmp;
    i += 1;
    j -= 1;
  }
  return next;
}

function twoOpt(start: RoutePoint | null, stops: GeoStop[]): GeoStop[] {
  let order = stops;
  let bestDistance = routeDistanceKm(start, order);

  for (let pass = 0; pass < TWO_OPT_MAX_PASSES; pass++) {
    let improved = false;
    let passBestDistance = bestDistance;
    let passBestOrder = order;

    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const candidate = reverseSegment(order, i, j);
        const distance = routeDistanceKm(start, candidate);
        if (distance + IMPROVEMENT_EPS < passBestDistance) {
          passBestDistance = distance;
          passBestOrder = candidate;
          improved = true;
        }
      }
    }

    if (!improved) break;
    order = passBestOrder;
    bestDistance = passBestDistance;
  }

  return order;
}

export function optimiseRoute(
  start: RoutePoint | null,
  stops: RouteStop[],
): { order: string[]; distanceKm: number } {
  const withCoords: GeoStop[] = [];
  const withoutCoords: RouteStop[] = [];

  for (const stop of stops) {
    if (hasCoords(stop)) {
      withCoords.push({ id: stop.id, lat: stop.lat, lng: stop.lng });
    } else {
      withoutCoords.push(stop);
    }
  }

  const improved = twoOpt(start, nearestNeighbour(start, withCoords));
  return {
    order: [...improved.map((stop) => stop.id), ...withoutCoords.map((stop) => stop.id)],
    distanceKm: routeDistanceKm(start, improved),
  };
}
