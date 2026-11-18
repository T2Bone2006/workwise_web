import { describe, expect, it } from 'vitest';
import { customersToCsv, summariseSelection, toExportRow } from '@/lib/customers/export-csv';

describe('customers export file', () => {
  it('writes the header and one quoted line per customer', () => {
    const csv = customersToCsv([
      { id: '1', name: 'Acme "Ltd"', type: 'bulk_client', email: 'a@x.com', phone: null, job_count: 3 },
      { id: '2', name: 'Bob', type: 'individual', email: null, phone: '07700 900123', job_count: 0 },
    ]);
    expect(csv.split('\n')).toEqual([
      'Name,Type,Email,Phone,Total Jobs',
      '"Acme ""Ltd""","bulk_client","a@x.com","","3"',
      '"Bob","individual","","07700 900123","0"',
    ]);
  });

  it('keeps what the export needs from a list row', () => {
    expect(toExportRow({ id: '1', name: 'A', type: 'individual', job_count: 2, extra: 'x' } as never)).toEqual({
      id: '1', name: 'A', type: 'individual', email: null, phone: null, job_count: 2,
    });
  });
});

describe('ticked customers across pages', () => {
  it('counts the ones on other pages instead of dropping them', () => {
    expect(summariseSelection(['a', 'b', 'z'], ['a', 'b', 'c'])).toEqual({ total: 3, onThisPage: 2, onOtherPages: 1 });
  });
  it('is empty when nothing is ticked', () => {
    expect(summariseSelection([], ['a'])).toEqual({ total: 0, onThisPage: 0, onOtherPages: 0 });
  });
});
