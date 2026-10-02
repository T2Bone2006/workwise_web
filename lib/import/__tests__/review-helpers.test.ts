import { describe, expect, it } from 'vitest';
import { blankExtractedCustomerRow, prepareExtractedCustomerRow, type ExtractedCustomerRow } from '@/lib/import/extracted-customer-row';
import { effectiveNextVisit, findRepeatRows, owedFromBefore } from '@/lib/import/review-helpers';
import { nameKey } from '@/lib/rounds/import-plan';

const TODAY = '2026-10-01';
const prep = (over: Partial<ExtractedCustomerRow>, idx = 0) =>
  prepareExtractedCustomerRow(
    { ...blankExtractedCustomerRow(idx), status: '', name: 'Ann Lee', address: '1 High St', postcode: 'TN23 5CD', price: '12', frequency: '4 weeks', ...over },
    {}, {}, {}, TODAY
  );

describe('nameKey', () => {
  it.each([
    ['Mrs. P  Okafor', 'p okafor'],
    ['  Mr & Mrs Henderson ', 'henderson'],
    ['Dr Anil Shah', 'anil shah'],
    ['D. Brannigan', 'd brannigan'],
    ["O'Neill", 'o neill'],
    ['ANN LEE', 'ann lee'],
  ])('%s → %s', (raw, key) => expect(nameKey(raw)).toBe(key));
});

describe('findRepeatRows', () => {
  it('flags the same person at the same address, not a second address', () => {
    const rows = [
      prep({}, 0),
      prep({ name: 'Mrs Ann Lee' }, 1),
      prep({ address: 'Rear Annexe, 1 High St' }, 2),
      prep({ postcode: 'TN24 0EF' }, 3),
    ];
    expect([...findRepeatRows(rows)]).toEqual([[1, 0]]);
  });
  it('ignores skipped rows', () => {
    expect(findRepeatRows([prep({}, 0), prep({ status: 'cancelled' }, 1)]).size).toBe(0);
  });
});

describe('effectiveNextVisit', () => {
  it('prefers the sheet, then last visit, then the default, then today', () => {
    expect(effectiveNextVisit(prep({ next_visit_date: '2026-10-22' }), null, TODAY)).toEqual({ date: '2026-10-22', source: 'sheet' });
    expect(effectiveNextVisit(prep({ last_visit_date: '2026-09-03' }), null, TODAY)).toEqual({ date: '2026-10-01', source: 'from-last-visit' });
    expect(effectiveNextVisit(prep({}), '2026-11-02', TODAY)).toEqual({ date: '2026-11-02', source: 'default' });
    expect(effectiveNextVisit(prep({}), null, TODAY)).toEqual({ date: TODAY, source: 'today' });
  });
});

describe('owedFromBefore', () => {
  it('adds up only rows that would be imported', () => {
    const rows = [prep({ balance_owed: '25' }, 0), prep({ balance_owed: '10.50' }, 1), prep({ balance_owed: '99', status: 'cancelled' }, 2), prep({ balance_owed: '5', postcode: '' }, 3)];
    expect(owedFromBefore(rows)).toEqual({ total: 35.5, customers: 2 });
  });
});
