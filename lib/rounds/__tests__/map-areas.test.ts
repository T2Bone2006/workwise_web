import { describe, expect, it } from 'vitest';
import {
  convexHull,
  heatWeight,
  outlineAround,
  pinState,
  placesInBounds,
  summarisePlaces,
  type LatLng,
  type MapPlace,
} from '@/lib/rounds/map-areas';

function place(id: string, over: Partial<MapPlace> = {}): MapPlace {
  return {
    id,
    customerId: id,
    customerName: id,
    title: 'Windows',
    address: '1 Elm Road',
    postcode: 'LS1 1AA',
    lat: 53.8,
    lng: -1.55,
    yearly: 100,
    visitsThisMonth: 1,
    dueThisWeek: false,
    owes: false,
    owed: 0,
    price: 20,
    frequencyLabel: 'Every 4 weeks',
    nextVisit: null,
    phone: null,
    roundId: null,
    ...over,
  };
}

describe('pinState', () => {
  it('shows owed first, then due this week, else fine', () => {
    expect(pinState({ owes: true, dueThisWeek: true })).toBe('owes');
    expect(pinState({ owes: false, dueThisWeek: true })).toBe('due');
    expect(pinState({ owes: false, dueThisWeek: false })).toBe('fine');
  });
});

describe('summarisePlaces', () => {
  it('counts a customer with two places once and their debt once', () => {
    const stats = summarisePlaces([
      place('a1', { customerId: 'a', yearly: 200, visitsThisMonth: 2, owes: true, owed: 30 }),
      place('a2', { customerId: 'a', yearly: 100, visitsThisMonth: 1, owes: true, owed: 0 }),
      place('b1', { customerId: 'b', yearly: 50, visitsThisMonth: 1 }),
    ]);
    expect(stats).toEqual({ customers: 2, yearly: 350, visitsThisMonth: 4, owed: 30 });
  });

  it('is all zeros for nothing on screen', () => {
    expect(summarisePlaces([])).toEqual({ customers: 0, yearly: 0, visitsThisMonth: 0, owed: 0 });
  });
});

describe('placesInBounds', () => {
  it('keeps only places inside the box, edges included', () => {
    const inside = place('in', { lat: 53.8, lng: -1.5 });
    const edge = place('edge', { lat: 53.9, lng: -1.4 });
    const outside = place('out', { lat: 54.5, lng: -1.5 });
    const kept = placesInBounds([inside, edge, outside], { south: 53.7, west: -1.6, north: 53.9, east: -1.4 });
    expect(kept.map((p) => p.id)).toEqual(['in', 'edge']);
  });
});

describe('convexHull', () => {
  it('drops points inside the shape', () => {
    const hull = convexHull([[0, 0], [0, 4], [4, 4], [4, 0], [2, 2]]);
    expect(hull).toHaveLength(4);
    expect(hull).not.toContainEqual([2, 2]);
  });

  it('returns what it was given for fewer than three points', () => {
    expect(convexHull([[1, 1]])).toEqual([[1, 1]]);
  });
});

function contains(poly: LatLng[], p: LatLng): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

describe('outlineAround', () => {
  it('encloses every point, with room to spare', () => {
    const pts: LatLng[] = [[53.8, -1.55], [53.81, -1.5], [53.79, -1.53]];
    const outline = outlineAround(pts, 400);
    for (const p of pts) expect(contains(outline, p)).toBe(true);
    const lats = outline.map((p) => p[0]);
    expect(Math.max(...lats)).toBeGreaterThan(53.81);
    expect(Math.min(...lats)).toBeLessThan(53.79);
  });

  it('still draws a shape around a single customer', () => {
    const outline = outlineAround([[53.8, -1.55]], 300);
    expect(outline.length).toBeGreaterThanOrEqual(3);
    expect(contains(outline, [53.8, -1.55])).toBe(true);
  });

  it('is empty for no customers', () => {
    expect(outlineAround([], 300)).toEqual([]);
  });
});

describe('heatWeight', () => {
  it('scales money by the biggest place and gives every customer the same weight', () => {
    expect(heatWeight(place('a', { yearly: 50 }), 'money', 200)).toBe(0.25);
    expect(heatWeight(place('a', { yearly: 500 }), 'money', 200)).toBe(1);
    expect(heatWeight(place('a', { yearly: 50 }), 'customers', 200)).toBe(1);
    expect(heatWeight(place('a', { yearly: 50 }), 'money', 0)).toBe(0);
  });
});
