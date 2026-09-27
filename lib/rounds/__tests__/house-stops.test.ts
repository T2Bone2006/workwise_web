import { describe, expect, it } from 'vitest';
import { groupHouseStops } from '@/lib/rounds/house-stops';

describe('groupHouseStops', () => {
  it('groups the same customer and address', () => {
    const groups = groupHouseStops([
      { id: 'a', customer_id: 'c1', address: '1 High Street', postcode: 'M20 1GH' },
      { id: 'b', customer_id: 'c1', address: '1 High Street', postcode: 'M20 1GH' },
      { id: 'c', customer_id: 'c1', address: '9 Other Road', postcode: 'M1 1AA' },
    ]);
    expect(groups.map((group) => group.map((row) => row.id))).toEqual([['a', 'b'], ['c']]);
  });
});
