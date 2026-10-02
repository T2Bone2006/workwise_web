import { describe, expect, it } from 'vitest';
import {
  blankExtractedCustomerRow,
  isImportableCustomerRow,
  parseCustomerStatus,
  parseMoneyAmount,
  parseWeekday,
  prepareExtractedCustomerRow,
  summariseCustomerRows,
  UNREADABLE_ROW_MESSAGE,
  type ExtractedCustomerRow,
} from '@/lib/import/extracted-customer-row';

const TODAY = '2026-10-01';

function row(over: Partial<ExtractedCustomerRow> = {}): ExtractedCustomerRow {
  return {
    ...blankExtractedCustomerRow(0),
    status: '',
    name: 'Mrs P Okafor',
    phone: '07700 900222',
    address: '3 Willow Rd, Ashford',
    postcode: 'TN23 5CD',
    price: '12.50',
    frequency: '4 weeks',
    ...over,
  };
}

const prep = (
  over: Partial<ExtractedCustomerRow> = {},
  edits = {},
  defaults = {}
) => prepareExtractedCustomerRow(row(over), {}, edits, defaults, TODAY);

describe('a clean row', () => {
  it('is ok with nothing to flag', () => {
    const r = prep();
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.price).toBe(12.5);
    expect(r.frequencyDays).toBe(28);
    expect(r.phoneE164).toBe('+447700900222');
    expect(r.status).toBe('active');
    expect(isImportableCustomerRow(r)).toBe(true);
  });
});

describe('red errors (item 1)', () => {
  it('flags a missing name', () => {
    expect(prep({ name: '' }).errors).toContain('Missing name');
  });
  it('flags a missing postcode', () => {
    const r = prep({ postcode: '', address: '1 Oak Drive Ashford' });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/Missing postcode/);
  });
  it('flags an invalid postcode (incomplete)', () => {
    const r = prep({ postcode: 'TN25 6' });
    expect(r.errors.join()).toMatch(/Invalid postcode "TN25 6"/);
  });
  it('finds a postcode written into the address and removes it from the address', () => {
    const r = prep({ postcode: '', address: '14 Maple Close, Ashford TN23 4AB' });
    expect(r.postcode).toBe('TN23 4AB');
    expect(r.address).toBe('14 Maple Close, Ashford');
    expect(r.ok).toBe(true);
  });
  it('accepts a lower-case postcode', () => {
    expect(prep({ postcode: 'tn23 5cd' }).postcode).toBe('TN23 5CD');
  });
  it('flags a price the sheet gave but we cannot read', () => {
    expect(prep({ price: 'tbc' }).errors.join()).toMatch(/read the price "tbc"/);
  });
  it('flags a frequency the sheet gave but we cannot read', () => {
    expect(prep({ frequency: 'whenever he rings' }).errors.join()).toMatch(/how often/);
  });
  it('flags a missing frequency unless a default is set', () => {
    expect(prep({ frequency: '' }).errors.join()).toMatch(/No frequency/);
    const r = prep({ frequency: '' }, {}, { frequencyDays: 28 });
    expect(r.ok).toBe(true);
    expect(r.frequencyDays).toBe(28);
  });
  it('flags a missing price unless a default is set', () => {
    expect(prep({ price: '' }).errors.join()).toMatch(/No price/);
    expect(prep({ price: '' }, {}, { price: 12 }).price).toBe(12);
  });
  it('flags a next visit more than a year ago, not a recent overdue one', () => {
    expect(prep({ next_visit_date: '2024-12-31' }).errors.join()).toMatch(/more than a year ago/);
    expect(prep({ next_visit_date: '2026-09-09' }).ok).toBe(true);
  });
  it('flags a next date it cannot read', () => {
    expect(prep({ next_visit_date: 'soonish' }).errors.join()).toMatch(/next visit date/);
  });
  it('an unread row says so, and clears once a name is typed in', () => {
    const blank = prepareExtractedCustomerRow(blankExtractedCustomerRow(3), {}, {}, {}, TODAY);
    expect(blank.errors).toContain(UNREADABLE_ROW_MESSAGE);
    const fixed = prepareExtractedCustomerRow(
      blankExtractedCustomerRow(3),
      {},
      { name: 'A Person', address: '1 Road', postcode: 'TN23 5CD', price: '10', frequency: '4 weeks' },
      {},
      TODAY
    );
    expect(fixed.ok).toBe(true);
  });
  it('edits win over what the AI read', () => {
    const r = prep({ postcode: 'nope' }, { postcode: 'TN24 0EF' });
    expect(r.postcode).toBe('TN24 0EF');
    expect(r.ok).toBe(true);
  });
});

describe('balance owed (item 2)', () => {
  it.each([
    ['', null],
    ['0', null],
    ['-5', null],
    ['credit 5', null],
    ['£1,234.50', 1234.5],
    ['12.5', 12.5],
    ['£25', 25],
  ])('%s → %s', (raw, expected) => {
    const r = prep({ balance_owed: raw });
    expect(r.balanceOwed).toBe(expected);
    expect(r.ok).toBe(true);
  });
  it('flags above £10,000', () => {
    expect(prep({ balance_owed: '10000.01' }).errors).toContain('Check this amount owed');
  });
  it('flags an amount it cannot read rather than dropping money owed', () => {
    expect(prep({ balance_owed: 'a tenner' }).errors.join()).toMatch(/what they owe/);
  });
});

describe('status (item 3)', () => {
  it.each([
    ['', 'active'],
    ['Active', 'active'],
    ['paused', 'paused'],
    ['On hold', 'paused'],
    ['Holiday', 'paused'],
    ['cancelled', 'skip'],
    ['Left', 'skip'],
    ['moved away', 'skip'],
  ])('%s → %s', (raw, expected) => {
    expect(parseCustomerStatus(raw)).toBe(expected);
  });
  it('a cancelled row is greyed, skipped and never validated', () => {
    const r = prep({ status: 'cancelled', postcode: '', price: '', frequency: '' });
    expect(r.status).toBe('skip');
    expect(r.ok).toBe(true);
    expect(r.skipReason).toMatch(/Cancelled in your old system/);
    expect(isImportableCustomerRow(r)).toBe(false);
  });
  it('a totals row is skipped too', () => {
    const r = prep({ is_customer_row: false, name: 'TOTAL' });
    expect(r.status).toBe('skip');
    expect(r.skipReason).toMatch(/total or heading/);
  });
  it('un-skipping with an edit validates the row again', () => {
    const r = prep({ status: 'cancelled', postcode: '' }, { status: 'active' });
    expect(r.status).toBe('active');
    expect(r.ok).toBe(false);
  });
});

describe('dates (items 4 and 5)', () => {
  it('reads an edited day-first date', () => {
    expect(prep({}, { nextVisitDate: '03/04/2026' }).nextVisitDate).toBe('2026-04-03');
    expect(prep({}, { nextVisitDate: '3/4/26' }).nextVisitDate).toBe('2026-04-03');
  });
  it('carries both next and last visit (next wins later, in the save step)', () => {
    const r = prep({ next_visit_date: '2026-10-22', last_visit_date: '2026-09-24' });
    expect(r.nextVisitDate).toBe('2026-10-22');
    expect(r.lastVisitDate).toBe('2026-09-24');
  });
  it('an unreadable last visit is a warning, not an error', () => {
    const r = prep({ last_visit_date: 'Sept' });
    expect(r.ok).toBe(true);
    expect(r.warnings.join()).toMatch(/last visit/);
  });
});

describe('warnings never block', () => {
  it('a high price warns', () => {
    const r = prep({ price: '100' });
    expect(r.ok).toBe(true);
    expect(r.warnings.join()).toMatch(/high/);
  });
  it('a bad email is left out with a note', () => {
    const r = prep({ email: 'd.brannigan@example' });
    expect(r.email).toBe('');
    expect(r.ok).toBe(true);
    expect(r.warnings.join()).toMatch(/Email/);
  });
  it('a mobile that lost its leading 0 is still read', () => {
    expect(prep({ phone: '7700 900444' }).phoneE164).toBe('+447700900444');
  });
  it('+44 and landlines are read', () => {
    expect(prep({ phone: '+44 7700 900333' }).phoneE164).toBe('+447700900333');
    expect(prep({ phone: '01233 555777' }).phoneE164).toBe('+441233555777');
  });
  it('a junk phone is left out with a note', () => {
    const r = prep({ phone: 'ask next door' });
    expect(r.phoneE164).toBeNull();
    expect(r.warnings.join()).toMatch(/Phone/);
    expect(r.ok).toBe(true);
  });
});

describe('small parsers', () => {
  it('parseMoneyAmount', () => {
    expect(parseMoneyAmount('£12.50')).toBe(12.5);
    expect(parseMoneyAmount('1,234')).toBe(1234);
    expect(parseMoneyAmount('12 per visit')).toBe(12);
    expect(parseMoneyAmount('tbc')).toBeNull();
    expect(parseMoneyAmount('£15 + £5')).toBeNull();
  });
  it('parseWeekday', () => {
    expect(parseWeekday('Thursday')).toBe(4);
    expect(parseWeekday('Thursdays')).toBe(4);
    expect(parseWeekday('tues')).toBe(2);
    expect(parseWeekday('Sun')).toBe(7);
    expect(parseWeekday('whenever')).toBeNull();
  });
});

describe('summariseCustomerRows', () => {
  it('counts ready, to fix and skipped separately', () => {
    const rows = [
      prep(),
      prep({ postcode: '' }),
      prep({ status: 'cancelled' }),
      prep({ is_customer_row: false }),
    ];
    expect(summariseCustomerRows(rows)).toEqual({ ready: 1, toFix: 1, skipped: 2 });
  });
});
