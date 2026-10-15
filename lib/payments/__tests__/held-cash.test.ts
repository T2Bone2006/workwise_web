import { describe, expect, it } from 'vitest';
import { HELD_COLUMNS, bookDate, countsInBooks, isCollectedByPerson, isHeld } from '@/lib/payments/held-cash';

const base = { collected_by_worker_id: null, collected_by_name: null, handed_over_at: null };
const held = { ...base, collected_by_worker_id: 'w1', collected_by_name: 'Dave' };
const handed = { ...held, handed_over_at: '2026-10-05T10:00:00Z' };
const nameOnly = { ...base, collected_by_name: 'Dave' }; // worker row since deleted

describe('held cash rule', () => {
  it('a payment nobody collected is never held and always counts, dated when it was received', () => {
    expect(isCollectedByPerson(base)).toBe(false);
    expect(isHeld(base)).toBe(false);
    expect(countsInBooks(base)).toBe(true);
    expect(bookDate({ ...base, received_at: '2026-10-03T09:00:00Z' })).toBe('2026-10-03T09:00:00Z');
  });

  it('cash a person collected is held, and does not count, until it is handed over', () => {
    expect(isHeld(held)).toBe(true);
    expect(countsInBooks(held)).toBe(false);
    expect(isHeld({ ...held, status: 'active' })).toBe(true);
  });

  it('once handed over it counts, dated the day it was handed over', () => {
    expect(isHeld(handed)).toBe(false);
    expect(countsInBooks(handed)).toBe(true);
    expect(bookDate({ ...handed, received_at: '2026-10-03T09:00:00Z' })).toBe('2026-10-05T10:00:00Z');
  });

  it('stays held when only the collector’s name is left (their worker row was deleted)', () => {
    expect(isCollectedByPerson(nameOnly)).toBe(true);
    expect(isHeld(nameOnly)).toBe(true);
    expect(countsInBooks(nameOnly)).toBe(false);
  });

  it('a voided payment is not held (it appears on no list), though it never counts either way', () => {
    expect(isHeld({ ...held, status: 'void' })).toBe(false);
  });

  it('names the columns every query needs', () => {
    expect(HELD_COLUMNS).toBe('collected_by_worker_id, collected_by_name, handed_over_at');
  });
});
