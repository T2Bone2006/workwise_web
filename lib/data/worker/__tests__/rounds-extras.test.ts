import { describe, expect, it } from 'vitest';
import { NOT_ROUNDS, firstNameOf, shapeHeldCash } from '../rounds-extras-core';

describe('shapeHeldCash', () => {
  it('shows what they hold, in pounds and payments', () => {
    expect(shapeHeldCash([{ amount: 20 }, { amount: 25 }], 45)).toEqual({ total: 45, count: 2 });
  });
  it('is nothing at £0, so no cash card shows', () => {
    expect(shapeHeldCash([], 0)).toBeNull();
    expect(shapeHeldCash([{ amount: 0 }], 0)).toBeNull();
  });
  it('rounds away floating point dust', () => {
    expect(shapeHeldCash([{ amount: 0.1 }, { amount: 0.2 }], 0.1 + 0.2)).toEqual({ total: 0.3, count: 2 });
  });
});

describe('firstNameOf / NOT_ROUNDS', () => {
  it('takes the first name, or nothing', () => {
    expect(firstNameOf('  Taylor  Smith ')).toBe('Taylor');
    expect(firstNameOf('')).toBeNull();
    expect(firstNameOf(null)).toBeNull();
  });
  it('a login that is not a Rounds lead gets nothing extra', () => {
    expect(NOT_ROUNDS).toEqual({ employerIsRounds: false, handToName: null, heldCash: null });
  });
});
