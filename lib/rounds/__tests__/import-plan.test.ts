import { describe, expect, it } from 'vitest';
import {
  blankExtractedCustomerRow,
  prepareExtractedCustomerRow,
  type ExtractedCustomerRow,
  type PreparedCustomerRow,
} from '@/lib/import/extracted-customer-row';
import {
  agreementTitle,
  nameKey,
  planImportRow,
  titleKey,
  type ImportExisting,
} from '@/lib/rounds/import-plan';

const TODAY = '2026-10-01';

function prep(over: Partial<ExtractedCustomerRow> = {}, idx = 0): PreparedCustomerRow {
  return prepareExtractedCustomerRow(
    {
      ...blankExtractedCustomerRow(idx),
      status: '',
      name: 'Ann Lee',
      address: '1 High Street',
      postcode: 'TN23 5CD',
      price: '12',
      frequency: '4 weeks',
      ...over,
    },
    {},
    {},
    {},
    TODAY,
  );
}

const empty = (): ImportExisting => ({ customers: [], agreements: [] });

describe('nameKey', () => {
  it.each([
    ['Mrs. P  Okafor', 'p okafor'],
    ['  Mr & Mrs Henderson ', 'henderson'],
    ['Dr Anil Shah', 'anil shah'],
    ['ANN LEE', 'ann lee'],
    ["O'Neill", 'o neill'],
    ['ms.  Jane   Smith', 'jane smith'],
  ])('%s → %s', (raw, key) => {
    expect(nameKey(raw)).toBe(key);
  });
});

describe('planImportRow', () => {
  it('skips a customer and agreement that are already here, and does not add the balance again', () => {
    const existing: ImportExisting = {
      customers: [{ id: 'c1', nameKey: 'ann lee', postcodes: ['TN23 5CD'] }],
      agreements: [
        { customerId: 'c1', titleKey: 'regular visit', postcode: 'tn23  5cd', status: 'active' },
      ],
    };
    const plan = planImportRow(prep({ balance_owed: '12.50' }), existing, TODAY);
    expect(plan.customer).toEqual({ matchId: 'c1' });
    expect(plan.agreement).toBe('skip_existing');
    expect(plan.balance).toBeNull();
    expect(plan.pause).toBe(false);
  });

  it('treats a second address for the only person with that name as the same customer and a new agreement', () => {
    const existing: ImportExisting = {
      customers: [{ id: 'c1', nameKey: 'ann lee', postcodes: ['TN23 5CD'] }],
      agreements: [
        { customerId: 'c1', titleKey: 'regular visit', postcode: 'TN23 5CD', status: 'active' },
      ],
    };
    const second = prep({ address: '4 Oak Avenue', postcode: 'TN24 0EF' }, 1);
    const plan = planImportRow(second, existing, TODAY);
    expect(plan.customer).toEqual({ matchId: 'c1' });
    expect(plan.agreement).toBe('create');
    expect(plan.balance).toBeNull();
  });

  it('keeps two people who share a name at different postcodes as two customers', () => {
    const existing: ImportExisting = {
      customers: [
        { id: 'c1', nameKey: 'ann lee', postcodes: ['TN23 5CD'] },
        { id: 'c2', nameKey: 'ann lee', postcodes: ['TN24 0EF'] },
      ],
      agreements: [],
    };
    expect(planImportRow(prep(), existing, TODAY).customer).toEqual({ matchId: 'c1' });
    expect(planImportRow(prep({ postcode: 'TN24 0EF', address: '4 Oak Avenue' }, 1), existing, TODAY).customer).toEqual({
      matchId: 'c2',
    });
    // A third postcode is not either of them.
    expect(
      planImportRow(prep({ postcode: 'SW1A 1AA', address: '10 The Mall' }, 2), existing, TODAY).customer,
    ).toEqual({ create: true });
  });

  it('creates one customer then a second agreement when the file has two addresses', () => {
    const existing = empty();
    const first = planImportRow(prep({ balance_owed: '15' }), existing, TODAY);
    expect(first.customer).toEqual({ create: true });
    expect(first.balance).toBe(15);
    existing.customers.push({ id: 'new', nameKey: nameKey('Ann Lee'), postcodes: ['TN23 5CD'] });
    existing.agreements.push({
      customerId: 'new',
      titleKey: titleKey(agreementTitle('')),
      postcode: 'TN23 5CD',
      status: 'active',
    });
    const second = planImportRow(
      prep({ address: '4 Oak Avenue', postcode: 'TN24 0EF', balance_owed: '15' }, 1),
      existing,
      TODAY,
    );
    expect(second.customer).toEqual({ matchId: 'new' });
    expect(second.agreement).toBe('create');
    expect(second.balance).toBeNull();
  });

  it('picks the anchor from the sheet, then the last visit, then today', () => {
    const existing = empty();
    expect(planImportRow(prep({ next_visit_date: '2026-10-22' }), existing, TODAY).anchorDate).toBe('2026-10-22');
    // 1 Sep + 28 days lands on 29 Sep, which is before today, so the next one is 27 Oct.
    expect(planImportRow(prep({ last_visit_date: '2026-09-01' }), existing, TODAY).anchorDate).toBe('2026-10-27');
    expect(planImportRow(prep(), existing, TODAY).anchorDate).toBe(TODAY);
  });

  it('plans a pause only from the row status, and a balance only when creating', () => {
    const created = planImportRow(prep({ status: 'paused', balance_owed: '8' }), empty(), TODAY);
    expect(created.pause).toBe(true);
    expect(created.balance).toBe(8);
    const matched = planImportRow(prep({ status: 'paused', balance_owed: '8' }), {
      customers: [{ id: 'c1', nameKey: 'ann lee', postcodes: ['TN23 5CD'] }],
      agreements: [],
    }, TODAY);
    expect(matched.pause).toBe(true);
    expect(matched.balance).toBeNull();
    expect(matched.agreement).toBe('create');
  });
});
