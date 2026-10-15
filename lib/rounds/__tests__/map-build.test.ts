import { describe, expect, it } from 'vitest';
import { buildMapPlaces, type MapAgreementRow, type MapVisitRow } from '@/lib/rounds/map-build';

const range = {
  monthStart: '2026-10-01',
  monthEnd: '2026-10-31',
  weekStart: '2026-10-05',
  weekEnd: '2026-10-11',
};

function agreement(id: string, over: Partial<MapAgreementRow> = {}): MapAgreementRow {
  return {
    id,
    customer_id: `c-${id}`,
    customer_name: `Customer ${id}`,
    customer_phone: '07700 900123',
    title: 'Windows',
    address: '1 Elm Road',
    postcode: 'LS1 1AA',
    lat: 53.8,
    lng: -1.55,
    price: 20,
    frequency_days: 28,
    ...over,
  };
}

function visit(agreementId: string, date: string, status = 'assigned'): MapVisitRow {
  return { service_agreement_id: agreementId, scheduled_date: date, status };
}

describe('buildMapPlaces', () => {
  it('carries what the customer card needs', () => {
    const { places } = buildMapPlaces({
      agreements: [agreement('a')],
      visits: [],
      owedByCustomer: new Map(),
      nextVisitByAgreement: new Map([['a', '2026-10-09']]),
      ...range,
    });
    expect(places[0]).toMatchObject({ price: 20, frequencyLabel: 'Every 4 weeks', nextVisit: '2026-10-09', phone: '07700 900123' });
  });

  it('puts each place in its round', () => {
    const { places } = buildMapPlaces({
      agreements: [agreement('a'), agreement('b')],
      visits: [],
      owedByCustomer: new Map(),
      nextVisitByAgreement: new Map(),
      roundByAgreement: new Map([['a', 'r1']]),
      ...range,
    });
    expect(places.map((p) => p.roundId)).toEqual(['r1', null]);
  });

  it('works out the yearly value from price and how often', () => {
    const { places } = buildMapPlaces({ agreements: [agreement('a')], visits: [], owedByCustomer: new Map(), nextVisitByAgreement: new Map(), ...range });
    expect(places[0]!.yearly).toBeCloseTo((20 * 365) / 28, 5);
  });

  it('counts this month\'s visits, leaving out skipped ones and other months', () => {
    const { places } = buildMapPlaces({
      agreements: [agreement('a')],
      visits: [visit('a', '2026-10-06'), visit('a', '2026-10-20', 'completed'), visit('a', '2026-10-13', 'cancelled'), visit('a', '2026-11-03')],
      owedByCustomer: new Map(), nextVisitByAgreement: new Map(),
      ...range,
    });
    expect(places[0]!.visitsThisMonth).toBe(2);
  });

  it('flags due this week only for visits not done yet', () => {
    const { places } = buildMapPlaces({
      agreements: [agreement('a'), agreement('b'), agreement('c')],
      visits: [visit('a', '2026-10-07'), visit('b', '2026-10-07', 'completed'), visit('c', '2026-10-14')],
      owedByCustomer: new Map(), nextVisitByAgreement: new Map(),
      ...range,
    });
    expect(places.map((p) => p.dueThisWeek)).toEqual([true, false, false]);
  });

  it('puts what a customer owes on their first place only, but colours both', () => {
    const { places } = buildMapPlaces({
      agreements: [agreement('a1', { customer_id: 'x' }), agreement('a2', { customer_id: 'x' })],
      visits: [],
      owedByCustomer: new Map([['x', 45]]),
      nextVisitByAgreement: new Map(),
      ...range,
    });
    expect(places.map((p) => p.owed)).toEqual([45, 0]);
    expect(places.map((p) => p.owes)).toEqual([true, true]);
  });

  it('counts customers with no position instead of dropping them quietly', () => {
    const { places, unmappedCustomers } = buildMapPlaces({
      agreements: [
        agreement('a'),
        agreement('b', { lat: null, lng: null }),
        agreement('c1', { customer_id: 'z' }),
        agreement('c2', { customer_id: 'z', lat: null, lng: null }),
      ],
      visits: [],
      owedByCustomer: new Map(), nextVisitByAgreement: new Map(),
      ...range,
    });
    expect(places.map((p) => p.id)).toEqual(['a', 'c1']);
    expect(unmappedCustomers).toBe(1);
  });
});
