import { describe, expect, it } from 'vitest';
import type { MapPlace } from '@/lib/rounds/map-areas';
import {
  cleanRoundName,
  isRoundColour,
  membershipChanges,
  movingFromOtherRounds,
  nextRoundColour,
  placesInShape,
  pointInShape,
  ROUND_COLOURS,
  roundNameTaken,
  summariseRounds,
} from '@/lib/rounds/rounds';

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

const square: Array<[number, number]> = [
  [53.0, -1.0],
  [53.0, -0.9],
  [53.1, -0.9],
  [53.1, -1.0],
];

describe('cleanRoundName', () => {
  it('trims and tidies spacing', () => {
    expect(cleanRoundName('  Tuesday   north ')).toEqual({ ok: true, name: 'Tuesday north' });
  });

  it('asks for a name when empty or not text', () => {
    expect(cleanRoundName('   ')).toEqual({ ok: false, error: 'Give the round a name' });
    expect(cleanRoundName(undefined).ok).toBe(false);
  });

  it('refuses a very long name', () => {
    expect(cleanRoundName('x'.repeat(61)).ok).toBe(false);
    expect(cleanRoundName('x'.repeat(60)).ok).toBe(true);
  });
});

describe('roundNameTaken', () => {
  const rounds = [{ id: 'a', name: 'Tuesday north', colour: '#7c3aed' }];
  it('ignores capitals and spacing', () => {
    expect(roundNameTaken(' tuesday  NORTH', rounds)).toBe(true);
    expect(roundNameTaken('Thursday east', rounds)).toBe(false);
  });
  it('lets a round keep its own name when editing', () => {
    expect(roundNameTaken('Tuesday north', rounds, 'a')).toBe(false);
  });
});

describe('colours', () => {
  it('picks the first unused colour, then starts again', () => {
    expect(nextRoundColour([])).toBe(ROUND_COLOURS[0]);
    expect(nextRoundColour([ROUND_COLOURS[0]])).toBe(ROUND_COLOURS[1]);
    expect(nextRoundColour([...ROUND_COLOURS])).toBe(ROUND_COLOURS[0]);
  });
  it('only accepts six-digit hex colours', () => {
    expect(isRoundColour('#7c3aed')).toBe(true);
    expect(isRoundColour('purple')).toBe(false);
    expect(isRoundColour('#fff')).toBe(false);
    expect(isRoundColour(7)).toBe(false);
  });
});

describe('pointInShape', () => {
  it('is true inside, false outside, false for fewer than three corners', () => {
    expect(pointInShape([53.05, -0.95], square)).toBe(true);
    expect(pointInShape([53.2, -0.95], square)).toBe(false);
    expect(pointInShape([53.05, -0.95], [[53, -1], [53.1, -0.9]])).toBe(false);
  });
});

describe('placesInShape', () => {
  const places = [
    place('free', 53.05, -0.95),
    place('mine', 53.06, -0.96, { roundId: 'r1' }),
    place('theirs', 53.07, -0.97, { roundId: 'r2' }),
    place('outside', 54, -2),
  ];
  it('takes free places and never steals from another round', () => {
    expect(placesInShape(places, square, null).map((p) => p.id)).toEqual(['free']);
  });
  it('also takes the places already in the round being edited', () => {
    expect(placesInShape(places, square, 'r1').map((p) => p.id)).toEqual(['free', 'mine']);
  });
});

describe('summariseRounds', () => {
  it('adds up places, customers and yearly money per round', () => {
    const rounds = [{ id: 'r1', name: 'A', colour: '#7c3aed' }, { id: 'r2', name: 'B', colour: '#0891b2' }];
    const places = [
      place('a1', 53, -1, { customerId: 'x', roundId: 'r1', yearly: 100 }),
      place('a2', 53, -1, { customerId: 'x', roundId: 'r1', yearly: 50 }),
      place('b1', 53, -1, { roundId: 'r2', yearly: 30 }),
      place('none', 53, -1),
    ];
    const [a, b] = summariseRounds(rounds, places);
    expect(a).toMatchObject({ places: 2, customers: 1, yearly: 150 });
    expect(b).toMatchObject({ places: 1, customers: 1, yearly: 30 });
  });
});

describe('movingFromOtherRounds', () => {
  const places = [place('a', 53, -1, { roundId: 'r1' }), place('b', 53, -1, { roundId: 'r2' }), place('c', 53, -1)];
  it('counts only places that sit in a different round', () => {
    expect(movingFromOtherRounds(['a', 'b', 'c'], places, 'r1')).toBe(1);
    expect(movingFromOtherRounds(['a', 'b', 'c'], places, null)).toBe(2);
  });
});

describe('membershipChanges', () => {
  it('works out who joins and who leaves', () => {
    expect(membershipChanges(['a', 'b'], ['b', 'c'])).toEqual({ add: ['c'], remove: ['a'] });
    expect(membershipChanges([], ['a'])).toEqual({ add: ['a'], remove: [] });
  });
});
