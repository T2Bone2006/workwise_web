import { describe, expect, it } from 'vitest';
import { usualDaysLabel } from '../usual-days';

describe('usualDaysLabel', () => {
  it('says Mon–Fri for a normal week', () => {
    expect(usualDaysLabel([1, 2, 3, 4, 5])).toBe('Mon–Fri');
  });
  it('lists separate days', () => {
    expect(usualDaysLabel([1, 3, 5])).toBe('Mon, Wed, Fri');
  });
  it('joins a run but keeps a pair apart', () => {
    expect(usualDaysLabel([1, 2])).toBe('Mon, Tue');
    expect(usualDaysLabel([2, 3, 4, 6])).toBe('Tue–Thu, Sat');
  });
  it('handles every day, none, duplicates and rubbish', () => {
    expect(usualDaysLabel([1, 2, 3, 4, 5, 6, 7])).toBe('Every day');
    expect(usualDaysLabel([])).toBe('No usual days');
    expect(usualDaysLabel([5, 5, 1, 9, 0])).toBe('Mon, Fri');
  });
});
