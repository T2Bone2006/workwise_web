import { describe, expect, it } from 'vitest';
import { yearlyBlockLines, yearlyDialogLines } from '@/lib/billing/pro-yearly-copy';
import { buildYearlyItems, yearlySwitchFigures } from '@/lib/billing/pro-manage-core';

describe('yearlySwitchFigures', () => {
  it('Growth with 3 extras: £476 a month is £5,712 over a year, yearly is £4,760, saving £952', () => {
    expect(
      yearlySwitchFigures({ planMonthlyPence: 44900, extraMonthlyPence: 900, planYearlyPence: 449000, extraYearlyPence: 9000, extras: 3 }),
    ).toEqual({ monthlyPence: 47600, yearlyPence: 476000, yearOfMonthsPence: 571200, savesPence: 95200 });
  });

  it('no extras: the saving is exactly two months of the plan', () => {
    expect(
      yearlySwitchFigures({ planMonthlyPence: 14900, extraMonthlyPence: 1200, planYearlyPence: 149000, extraYearlyPence: 12000, extras: 0 }).savesPence,
    ).toBe(29800);
  });
});

describe('buildYearlyItems', () => {
  it('moves the plan line and keeps the extras quantity at the yearly extra price', () => {
    expect(
      buildYearlyItems({ planItemId: 'si_plan', yearlyPlanPriceId: 'price_y', extraItemId: 'si_x', extraQuantity: 3, yearlyExtraPriceId: 'price_xy' }),
    ).toEqual([
      { id: 'si_plan', price: 'price_y' },
      { id: 'si_x', price: 'price_xy', quantity: 3 },
    ]);
  });

  it('has only the plan line when there are no extras', () => {
    expect(
      buildYearlyItems({ planItemId: 'si_plan', yearlyPlanPriceId: 'price_y', extraItemId: null, extraQuantity: 0, yearlyExtraPriceId: null }),
    ).toEqual([{ id: 'si_plan', price: 'price_y' }]);
  });

  it('refuses to guess when extras exist but the yearly extra price is missing', () => {
    expect(() =>
      buildYearlyItems({ planItemId: 'a', yearlyPlanPriceId: 'b', extraItemId: 'c', extraQuantity: 2, yearlyExtraPriceId: null }),
    ).toThrow();
  });
});

describe('yearly copy', () => {
  it('block: Growth, 3 extras', () => {
    const b = yearlyBlockLines({ tier: 'growth', extras: 3 });
    expect(b.yearlyLabel).toBe('£4,760 a year');
    expect(b.comparison).toBe('instead of £5,712 over 12 months');
    expect(b.savesLabel).toBe('Save £952');
    expect(b.detail).toBe('Growth plan £4,490 + 3 extra workers × £90');
  });

  it('dialog: the real example from Stripe (£4,514.32 today, £245.68 credit)', () => {
    const d = yearlyDialogLines({
      todayPence: 451432,
      creditPence: 24568,
      yearlyPence: 476000,
      savesPence: 95200,
      startsOn: '2026-10-16T12:00:00Z',
      renewsOn: '2027-10-16T12:00:00Z',
    });
    expect(d.todayLine).toBe('Today you pay £4,514.32');
    expect(d.creditLine).toBe('That is the yearly price minus £245.68 back for the unused part of this month.');
    expect(d.yearLine).toBe('Your year starts today (16 Oct 2026). Your next yearly bill is £4,760 on 16 Oct 2027.');
    expect(d.button).toBe('Switch and pay £4,514.32');
  });
});
