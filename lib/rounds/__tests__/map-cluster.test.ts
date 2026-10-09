import { describe, expect, it } from 'vitest';
import type { MapPlace } from '@/lib/rounds/map-areas';
import { groupPlaces } from '@/lib/rounds/map-cluster';

function place(id: string, lat: number, lng: number): MapPlace {
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
  };
}

describe('groupPlaces', () => {
  const near = [place('a', 53.8, -1.55), place('b', 53.8003, -1.5503), place('c', 53.8005, -1.5499)];
  const far = place('far', 54.2, -1.2);

  it('bubbles up places that crowd each other when zoomed out, and keeps far ones single', () => {
    const groups = groupPlaces([...near, far], 10);
    expect(groups).toHaveLength(2);
    const big = groups.find((g) => g.members.length === 3)!;
    expect(big.members.map((m) => m.id).sort()).toEqual(['a', 'b', 'c']);
    expect(groups.find((g) => g.members.length === 1)!.members[0]!.id).toBe('far');
  });

  it('spreads them back out as you zoom in', () => {
    expect(groupPlaces(near, 17)).toHaveLength(3);
  });

  it('puts a bubble in the middle of its members', () => {
    const [g] = groupPlaces([place('a', 53.0, -1.0), place('b', 53.0002, -1.0002)], 5);
    expect(g!.lat).toBeCloseTo(53.0001, 6);
    expect(g!.lng).toBeCloseTo(-1.0001, 6);
  });

  it('keeps a single place\'s own id as its key', () => {
    expect(groupPlaces([far], 8)[0]!.key).toBe('far');
  });

  it('is empty for nothing', () => {
    expect(groupPlaces([], 8)).toEqual([]);
  });
});
