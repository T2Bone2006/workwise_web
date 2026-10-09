import { describe, expect, it } from 'vitest';
import { extrasToBill, planExtraWorkerChange, prorationFor } from '@/lib/billing/extra-workers-core';

const line = (quantity: number, priceId = 'price_starter_extra') => ({ itemId: 'si_1', priceId, quantity });

describe('planExtraWorkerChange', () => {
  it('does nothing when nobody is over and there is no extra line', () => {
    expect(planExtraWorkerChange({ over: 0, wantedPriceId: 'price_starter_extra', current: null })).toEqual({ kind: 'none' });
  });

  it('adds the line when the first worker goes over', () => {
    expect(planExtraWorkerChange({ over: 1, wantedPriceId: 'price_starter_extra', current: null })).toEqual({
      kind: 'add',
      priceId: 'price_starter_extra',
      quantity: 1,
    });
  });

  it('updates the quantity as more go over', () => {
    expect(planExtraWorkerChange({ over: 3, wantedPriceId: 'price_starter_extra', current: line(1) })).toEqual({
      kind: 'set',
      itemId: 'si_1',
      priceId: 'price_starter_extra',
      quantity: 3,
    });
  });

  it('leaves it alone when the quantity already matches', () => {
    expect(planExtraWorkerChange({ over: 2, wantedPriceId: 'price_starter_extra', current: line(2) })).toEqual({ kind: 'none' });
  });

  it('removes the line when the team is back within the allowance', () => {
    expect(planExtraWorkerChange({ over: 0, wantedPriceId: 'price_starter_extra', current: line(2) })).toEqual({
      kind: 'remove',
      itemId: 'si_1',
    });
  });

  it('swaps the price when the business changed tier', () => {
    expect(planExtraWorkerChange({ over: 2, wantedPriceId: 'price_growth_extra', current: line(2) })).toEqual({
      kind: 'set',
      itemId: 'si_1',
      priceId: 'price_growth_extra',
      quantity: 2,
    });
  });

  it('treats a negative or fractional count as safe', () => {
    expect(planExtraWorkerChange({ over: -4, wantedPriceId: 'p', current: null })).toEqual({ kind: 'none' });
    expect(planExtraWorkerChange({ over: 2.9, wantedPriceId: 'p', current: null })).toEqual({
      kind: 'add',
      priceId: 'p',
      quantity: 2,
    });
  });
});

describe('extrasToBill', () => {
  it('follows headcount when nothing was paid for up front', () => {
    expect(extrasToBill({ used: 12, included: 10, paidForWorkers: null })).toEqual({ over: 2, releasePaidFor: false });
    expect(extrasToBill({ used: 8, included: 10, paidForWorkers: null })).toEqual({ over: 0, releasePaidFor: false });
  });

  it('holds the signup extras until the team reaches that size', () => {
    expect(extrasToBill({ used: 0, included: 35, paidForWorkers: 40 })).toEqual({ over: 5, releasePaidFor: false });
    expect(extrasToBill({ used: 36, included: 35, paidForWorkers: 40 })).toEqual({ over: 5, releasePaidFor: false });
  });

  it('follows headcount once the team has caught the size they paid for', () => {
    expect(extrasToBill({ used: 40, included: 35, paidForWorkers: 40 })).toEqual({ over: 5, releasePaidFor: true });
    expect(extrasToBill({ used: 50, included: 35, paidForWorkers: 40 })).toEqual({ over: 15, releasePaidFor: true });
    expect(extrasToBill({ used: 30, included: 35, paidForWorkers: 40 }).over).toBe(5);
  });
});

describe('prorationFor', () => {
  it('charges a yearly change now and rolls a monthly one into the next bill', () => {
    expect(prorationFor('year')).toBe('always_invoice');
    expect(prorationFor('month')).toBe('create_prorations');
  });
});
