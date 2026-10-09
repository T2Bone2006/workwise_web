import { describe, expect, it } from 'vitest';
import type { MapPlace } from '@/lib/rounds/map-areas';
import { aroundPoint, buildDensity, glowPoints, makeProjection, rampColour } from '@/lib/rounds/map-heat';

function place(id: string, lat: number, lng: number, over: Partial<MapPlace> = {}): MapPlace {
  return {
    id,
    customerId: id,
    customerName: id,
    title: 'Windows',
    address: '1 Elm Road',
    postcode: 'LS1 1AA',
    lat,
    lng,
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

const proj = makeProjection(53.8);

describe('makeProjection', () => {
  it('measures a kilometre as a kilometre', () => {
    const a = proj.project(53.8, -1.55);
    const b = proj.project(53.8 + 1000 / 111_195, -1.55);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(995);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(1005);
  });

  it('round-trips', () => {
    const [lat, lng] = proj.unproject(proj.project(53.81, -1.5));
    expect(lat).toBeCloseTo(53.81, 6);
    expect(lng).toBeCloseTo(-1.5, 6);
  });
});

describe('buildDensity', () => {
  it('is busiest on top of a place and fades with distance', () => {
    const field = buildDensity([{ x: 0, y: 0, w: 1 }], 500);
    expect(field.at(0, 0)).toBeCloseTo(1, 6);
    expect(field.at(500, 0)).toBeLessThan(field.at(100, 0));
    expect(field.at(1600, 0)).toBe(0);
  });

  it('adds up places that sit close together', () => {
    const lone = buildDensity([{ x: 0, y: 0, w: 1 }], 500);
    const pair = buildDensity([{ x: 0, y: 0, w: 1 }, { x: 100, y: 0, w: 1 }], 500);
    expect(pair.peak).toBeGreaterThan(lone.peak);
  });

  it('has a peak of zero for nothing', () => {
    expect(buildDensity([], 500).peak).toBe(0);
    expect(buildDensity([], 500).busy).toBe(0);
  });

  it('sets "busy" by the busiest tenth, so one hot spot does not wash out the rest', () => {
    const spread = Array.from({ length: 19 }, (_, i) => ({ x: i * 10_000, y: 0, w: 1 }));
    const crowd = Array.from({ length: 30 }, (_, i) => ({ x: -50_000 + i * 5, y: 0, w: 1 }));
    const field = buildDensity([...spread, ...crowd], 500);
    expect(field.peak).toBeGreaterThan(10);
    expect(field.busy).toBeLessThan(field.peak);
  });
});

describe('rampColour', () => {
  it('is clear when quiet, green first, and ends in red rather than white', () => {
    expect(rampColour(0).a).toBe(0);
    const low = rampColour(0.1);
    expect(low.g).toBeGreaterThan(low.r);
    const top = rampColour(1);
    expect(top.r).toBeGreaterThan(top.g * 3);
    expect(top.r).toBeGreaterThan(top.b * 3);
    expect(top.a).toBeGreaterThan(0.85);
    expect(rampColour(0.9).r).toBeGreaterThan(rampColour(0.9).g);
  });

  it('clamps outside 0 to 1', () => {
    expect(rampColour(-3)).toEqual(rampColour(0));
    expect(rampColour(9)).toEqual(rampColour(1));
  });
});

describe('reading a spot', () => {
  const places = [place('a', 53.8, -1.55, { yearly: 200 }), place('b', 53.801, -1.55, { yearly: 100 }), place('far', 54.3, -1.55)];

  it('adds up everything within the distance and no more', () => {
    const at = proj.project(53.8, -1.55);
    expect(aroundPoint(places, proj.project, at, 1500)).toEqual({ customers: 2, yearly: 300 });
    expect(aroundPoint(places, proj.project, at, 50)).toEqual({ customers: 1, yearly: 200 });
  });

});

describe('glowPoints', () => {
  it('weights money by value but gives every customer the same weight, never nothing', () => {
    const places = [place('a', 53.8, -1.55, { yearly: 200 }), place('b', 53.8, -1.56, { yearly: 2 })];
    const money = glowPoints(places, proj.project, 'money');
    expect(money[0]!.w).toBe(1);
    expect(money[1]!.w).toBe(0.15);
    expect(glowPoints(places, proj.project, 'customers').map((p) => p.w)).toEqual([1, 1]);
  });
});
