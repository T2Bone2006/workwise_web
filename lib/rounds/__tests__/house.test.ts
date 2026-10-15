import { describe, expect, it } from 'vitest';
import { joinHouse, splitHouse } from '@/lib/rounds/house';

describe('joinHouse', () => {
  it('puts the postcode on the end of the address', () => {
    expect(joinHouse('12 Elm Road', 'SW1A 1AA')).toBe('12 Elm Road, SW1A 1AA');
  });

  it('tidies a typed postcode', () => {
    expect(joinHouse('12 Elm Road', 'sw1a1aa')).toBe('12 Elm Road, SW1A 1AA');
  });

  it('trims and keeps an address with no postcode', () => {
    expect(joinHouse('  12 Elm Road ', '')).toBe('12 Elm Road');
  });

  it('is null when there is no address', () => {
    expect(joinHouse('   ', 'SW1A 1AA')).toBeNull();
  });
});

describe('splitHouse', () => {
  it.each([
    ['12 Elm Road, SW1A 1AA', '12 Elm Road', 'SW1A 1AA'],
    ['12 Elm Road, Leeds, LS1 4AB', '12 Elm Road, Leeds', 'LS1 4AB'],
    ['12 Elm Road, sw1a1aa', '12 Elm Road', 'SW1A 1AA'],
  ])('splits %s', (line, address, postcode) => {
    expect(splitHouse(line)).toEqual({ address, postcode });
  });

  it('keeps the whole line when the end is not a postcode', () => {
    expect(splitHouse('12 Elm Road, Leeds')).toEqual({
      address: '12 Elm Road, Leeds',
      postcode: '',
    });
  });

  it('is empty for a customer with no address', () => {
    expect(splitHouse(null)).toEqual({ address: '', postcode: '' });
  });

  it('round-trips what joinHouse wrote', () => {
    const line = joinHouse('12 Elm Road, Leeds', 'LS1 4AB');
    expect(splitHouse(line)).toEqual({
      address: '12 Elm Road, Leeds',
      postcode: 'LS1 4AB',
    });
  });
});
