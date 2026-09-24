import { describe, expect, it } from 'vitest';
import { haversineDistance } from '@/lib/utils/haversine';
import {
  optimiseRoute,
  routeDistanceKm,
  type RouteStop,
} from '@/lib/rounds/route-optimiser';

function idsOf(stops: RouteStop[]): string[] {
  return stops.map((stop) => stop.id);
}

describe('routeDistanceKm', () => {
  it('is 0 for no stops', () => {
    expect(routeDistanceKm(null, [])).toBe(0);
    expect(routeDistanceKm({ lat: 51.5, lng: -0.1 }, [])).toBe(0);
  });

  it('is 0 for a single stop with no start, else start→stop', () => {
    const stop = { lat: 0, lng: 1 };
    expect(routeDistanceKm(null, [stop])).toBe(0);
    expect(routeDistanceKm({ lat: 0, lng: 0 }, [stop])).toBe(
      haversineDistance(0, 0, 0, 1),
    );
  });

  it('sums consecutive legs and the optional start', () => {
    const a = { lat: 0, lng: 0 };
    const b = { lat: 0, lng: 1 };
    const c = { lat: 1, lng: 1 };
    expect(routeDistanceKm(null, [a, b, c])).toBe(
      haversineDistance(0, 0, 0, 1) + haversineDistance(0, 1, 1, 1),
    );
    expect(routeDistanceKm({ lat: 1, lng: 0 }, [a, b])).toBe(
      haversineDistance(1, 0, 0, 0) + haversineDistance(0, 0, 0, 1),
    );
  });

  it('adds the hop from the last stop to the finish', () => {
    const stop = { lat: 0, lng: 1 };
    const start = { lat: 0, lng: 0 };
    const end = { lat: 1, lng: 1 };
    expect(routeDistanceKm(start, [], end)).toBe(0);
    expect(routeDistanceKm(start, [stop], end)).toBe(
      haversineDistance(0, 0, 0, 1) + haversineDistance(0, 1, 1, 1),
    );
  });
});

describe('optimiseRoute small cases', () => {
  it('returns empty for 0 stops', () => {
    expect(optimiseRoute(null, [])).toEqual({ order: [], distanceKm: 0 });
    expect(optimiseRoute({ lat: 0, lng: 0 }, [])).toEqual({
      order: [],
      distanceKm: 0,
    });
  });

  it('returns the single stop; distance is 0 without a start', () => {
    const stops: RouteStop[] = [{ id: 'only', lat: 51.5, lng: -0.12 }];
    expect(optimiseRoute(null, stops)).toEqual({
      order: ['only'],
      distanceKm: 0,
    });

    const start = { lat: 51.51, lng: -0.13 };
    const withStart = optimiseRoute(start, stops);
    expect(withStart.order).toEqual(['only']);
    expect(withStart.distanceKm).toBe(
      haversineDistance(start.lat, start.lng, 51.5, -0.12),
    );
  });

  it('keeps both stops and prefers the nearer one first when a start is given', () => {
    const near: RouteStop = { id: 'near', lat: 0, lng: 0.1 };
    const far: RouteStop = { id: 'far', lat: 0, lng: 2 };
    const start = { lat: 0, lng: 0 };

    const result = optimiseRoute(start, [far, near]);
    expect(result.order).toEqual(['near', 'far']);
    expect(result.distanceKm).toBe(
      routeDistanceKm(start, [
        { lat: near.lat!, lng: near.lng! },
        { lat: far.lat!, lng: far.lng! },
      ]),
    );
  });

  it('contains every id exactly once', () => {
    const stops: RouteStop[] = [
      { id: 'a', lat: 0, lng: 0 },
      { id: 'b', lat: null, lng: null },
      { id: 'c', lat: 0, lng: 1 },
      { id: 'd', lat: 1, lng: 1 },
      { id: 'e', lat: null, lng: 0 },
    ];
    const { order } = optimiseRoute({ lat: 0, lng: 0.5 }, stops);
    expect(order).toHaveLength(stops.length);
    expect(new Set(order).size).toBe(stops.length);
    expect(order.sort()).toEqual(idsOf(stops).sort());
  });
});

describe('finish point', () => {
  const start = { lat: 0, lng: 0 };
  const home = { lat: 0, lng: 0 };
  const a: RouteStop = { id: 'a', lat: 1, lng: 0.1 };
  const b: RouteStop = { id: 'b', lat: 2, lng: 0 };
  const c: RouteStop = { id: 'c', lat: 1, lng: -0.1 };
  const stops = [a, b, c];
  const point = (id: string) => {
    const stop = stops.find((item) => item.id === id)!;
    return { lat: stop.lat!, lng: stop.lng! };
  };

  it('open path ends at the far stop', () => {
    const open = optimiseRoute(start, stops);
    expect(open.order[open.order.length - 1]).toBe('b');
  });

  it('ending at home puts a nearer stop last and shortens the closed run', () => {
    const open = optimiseRoute(start, stops);
    const closed = optimiseRoute(start, stops, home);
    expect(closed.order).toHaveLength(3);
    expect(new Set(closed.order).size).toBe(3);
    expect(closed.order[closed.order.length - 1]).not.toBe('b');

    const closedDistanceOf = (ids: string[]) =>
      routeDistanceKm(
        start,
        ids.map((id) => point(id)),
        home,
      );
    expect(closed.distanceKm).toBeCloseTo(closedDistanceOf(closed.order), 8);
    expect(closed.distanceKm).toBeLessThan(closedDistanceOf(open.order));
  });
});

describe('stops without coordinates', () => {
  it('appends them at the end in input order and excludes them from distance', () => {
    const a: RouteStop = { id: 'a', lat: 0, lng: 0 };
    const b: RouteStop = { id: 'b', lat: 0, lng: 1 };
    const ghostFirst: RouteStop = { id: 'ghost-first', lat: null, lng: null };
    const ghostMid: RouteStop = { id: 'ghost-mid', lat: null, lng: 1 };
    const ghostLast: RouteStop = { id: 'ghost-last', lat: 1, lng: null };

    const result = optimiseRoute({ lat: 0, lng: -0.1 }, [
      ghostFirst,
      b,
      ghostMid,
      a,
      ghostLast,
    ]);

    expect(result.order.slice(-3)).toEqual([
      'ghost-first',
      'ghost-mid',
      'ghost-last',
    ]);
    expect(result.order.slice(0, 2).sort()).toEqual(['a', 'b']);

    const geoById: Record<string, { lat: number; lng: number }> = {
      a: { lat: a.lat!, lng: a.lng! },
      b: { lat: b.lat!, lng: b.lng! },
    };
    const geoPoints = result.order.slice(0, 2).map((id) => geoById[id]);
    expect(result.distanceKm).toBe(
      routeDistanceKm({ lat: 0, lng: -0.1 }, geoPoints),
    );
  });
});

describe('6-stop square: NN is suboptimal, 2-opt fixes it', () => {
  // 2×3 grid (a rectangle / "square" of six stops). Input order is chosen so
  // nearest-neighbour from the first stop zigzags and skips a long bottom
  // edge (6 unit-ish legs). 2-opt uncrosses it to a 5-leg U around the grid.
  const a1: RouteStop = { id: 'a1', lat: 0, lng: 0 };
  const a2: RouteStop = { id: 'a2', lat: 0, lng: 1 };
  const a3: RouteStop = { id: 'a3', lat: 0, lng: 2 };
  const b1: RouteStop = { id: 'b1', lat: 1, lng: 0 };
  const b2: RouteStop = { id: 'b2', lat: 1, lng: 1 };
  const b3: RouteStop = { id: 'b3', lat: 1, lng: 2 };
  const stops = [a2, b2, a1, a3, b1, b3];

  const point = (stop: RouteStop) => ({ lat: stop.lat!, lng: stop.lng! });
  const byId = Object.fromEntries(stops.map((stop) => [stop.id, stop]));

  function pathDistance(ids: string[]): number {
    return routeDistanceKm(
      null,
      ids.map((id) => point(byId[id])),
    );
  }

  const nnOrder = ['a2', 'b2', 'b1', 'a1', 'a3', 'b3'];
  const nnDistance = pathDistance(nnOrder);

  it('starts NN from the first stop when start is null (zigzag of length 6)', () => {
    expect(nnDistance).toBeGreaterThan(pathDistance(['a2', 'a1', 'b1', 'b2', 'b3', 'a3']));
  });

  it('2-opt shortens that path and keeps every id once', () => {
    const result = optimiseRoute(null, stops);
    expect(result.order).toHaveLength(6);
    expect(new Set(result.order).size).toBe(6);
    expect([...result.order].sort()).toEqual(['a1', 'a2', 'a3', 'b1', 'b2', 'b3']);

    expect(result.distanceKm).toBeLessThan(nnDistance);
    expect(result.distanceKm).toBeCloseTo(pathDistance(result.order), 8);

    const optimal = Math.min(
      pathDistance(['a2', 'a1', 'b1', 'b2', 'b3', 'a3']),
      pathDistance(['a2', 'a3', 'b3', 'b2', 'b1', 'a1']),
    );
    expect(result.distanceKm).toBeCloseTo(optimal, 5);
  });

  it('is deterministic for equal inputs', () => {
    const first = optimiseRoute(null, stops);
    const second = optimiseRoute(null, stops);
    expect(second).toEqual(first);
  });
});
