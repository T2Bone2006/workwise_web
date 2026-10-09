import { describe, expect, it } from 'vitest';
import { proBreakdown, splitProItems, teamNote, type ProItem } from '@/lib/billing/pro-plan-core';

const plan: ProItem = { id: 'si_plan', priceId: 'price_starter', quantity: 1, unitPence: 14900 };
const extra: ProItem = { id: 'si_extra', priceId: 'price_extra_starter', quantity: 3, unitPence: 1200 };

const tierOfPrice = (id: string) => (id === 'price_starter' ? ('starter' as const) : null);
const isExtra = (id: string) => id === 'price_extra_starter';

describe('splitProItems', () => {
  it('finds the plan line and the extra line whichever comes first', () => {
    expect(splitProItems([plan, extra], tierOfPrice, isExtra)).toEqual({ plan, tier: 'starter', extra });
    expect(splitProItems([extra, plan], tierOfPrice, isExtra)).toEqual({ plan, tier: 'starter', extra });
  });

  it('has no extra line when there are no extras', () => {
    expect(splitProItems([plan], tierOfPrice, isExtra)).toEqual({ plan, tier: 'starter', extra: null });
  });

  it('has no plan when the price is unknown', () => {
    expect(splitProItems([extra], tierOfPrice, isExtra)).toEqual({ plan: null, tier: null, extra });
  });
});

describe('proBreakdown', () => {
  it('is just the plan when nobody is over', () => {
    const b = proBreakdown({ tierName: 'Starter', planUnitPence: 14900, extraQuantity: 0, extraUnitPence: 1200 });
    expect(b.lines).toEqual([{ label: 'Starter plan', quantity: 1, unitPence: 14900, totalPence: 14900 }]);
    expect(b.monthlyPence).toBe(14900);
  });

  it('adds the extra workers line and totals it', () => {
    const b = proBreakdown({ tierName: 'Starter', planUnitPence: 14900, extraQuantity: 3, extraUnitPence: 1200 });
    expect(b.lines[1]).toEqual({ label: 'Extra workers', quantity: 3, unitPence: 1200, totalPence: 3600 });
    expect(b.monthlyPence).toBe(18500);
  });

  it('ignores a negative quantity', () => {
    const b = proBreakdown({ tierName: 'Pro', planUnitPence: 74900, extraQuantity: -2, extraUnitPence: 600 });
    expect(b.lines).toHaveLength(1);
    expect(b.monthlyPence).toBe(74900);
  });
});

describe('teamNote', () => {
  it('monthly, with extras: says the price and that removing lowers the next bill', () => {
    expect(teamNote({ over: 3, included: 35, unitPence: 900, interval: 'month' })).toBe(
      'Each extra worker is £9 a month, billed with your plan. Removing someone from the team lowers your next bill.',
    );
  });

  it('monthly, no extras: shows the real price, not £0', () => {
    expect(teamNote({ over: 0, included: 35, unitPence: 900, interval: 'month' })).toBe(
      "You only pay for workers beyond the 35 included. Each extra worker is £9 a month, and you're asked before it's added.",
    );
  });

  it('yearly: the yearly price, charged for the months left, credit on removal', () => {
    const note = teamNote({ over: 2, included: 10, unitPence: 12000, interval: 'year' });
    expect(note).toBe(
      'Each extra worker is £120 a year. Add one part-way through the year and you pay only for the months left, straight away. Remove one and the unused part comes back as credit.',
    );
    expect(teamNote({ over: 0, included: 10, unitPence: 12000, interval: 'year' })).toContain('You only pay for workers beyond the 10 included. ');
    expect(note).not.toContain('a month');
  });
});
