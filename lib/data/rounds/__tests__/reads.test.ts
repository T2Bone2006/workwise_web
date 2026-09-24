import { describe, expect, it } from 'vitest';
import { summariseCustomerAgreements } from '@/lib/data/rounds/customers';
import { summariseTodayVisits } from '@/lib/data/rounds/home';
import { foldVisitCounts, mapVisitRow, type VisitRow } from '@/lib/data/rounds/visits';

describe('summariseCustomerAgreements', () => {
  it('counts all agreements and takes postcode from the first active one', () => {
    expect(
      summariseCustomerAgreements([
        { id: '1', status: 'paused', postcode: 'E1 1AA' },
        { id: '2', status: 'active', postcode: 'SW1A 1AA' },
        { id: '3', status: 'active', postcode: 'N1 9GU' },
        { id: '4', status: 'ended', postcode: 'W1A 1AA' },
      ]),
    ).toEqual({
      agreement_count: 4,
      active_agreement_count: 2,
      postcode: 'SW1A 1AA',
    });
  });

  it('returns a null postcode when nothing is active', () => {
    expect(
      summariseCustomerAgreements([{ id: '1', status: 'ended', postcode: 'SW1A 1AA' }]),
    ).toEqual({ agreement_count: 1, active_agreement_count: 0, postcode: null });
  });
});

describe('foldVisitCounts', () => {
  it('buckets total / done / skipped by day; cancelled is skipped', () => {
    expect(
      foldVisitCounts([
        { scheduled_date: '2026-09-18', status: 'assigned', quoted_amount: 12 },
        { scheduled_date: '2026-09-18', status: 'completed', quoted_amount: 18 },
        { scheduled_date: '2026-09-18', status: 'cancelled', quoted_amount: 40 },
        { scheduled_date: '2026-09-19', status: 'assigned', quoted_amount: '9.50' },
      ]),
    ).toEqual({
      '2026-09-18': { total: 3, done: 1, skipped: 1, plannedAmount: 30 },
      '2026-09-19': { total: 1, done: 0, skipped: 0, plannedAmount: 9.5 },
    });
  });
});

describe('mapVisitRow', () => {
  it('reads the customer embed and numeric money fields', () => {
    const visit = mapVisitRow({
      id: '11111111-1111-4111-8111-111111111111',
      reference_number: 'R-A1B2C3-20260918',
      customer_id: '22222222-2222-4222-8222-222222222222',
      customers: { name: 'Jane Smith' },
      service_agreement_id: '33333333-3333-4333-8333-333333333333',
      agreement_occurrence_date: '2026-09-18',
      address: '12 Elm Road',
      postcode: 'SW1A 1AA',
      lat: '51.5',
      lng: '-0.1',
      job_description: 'Window clean (front)',
      status: 'assigned',
      scheduled_date: '2026-09-18',
      scheduled_time: '09:00:00',
      estimated_duration_minutes: 20,
      quoted_amount: '12.00',
      final_amount: null,
      payment_status: 'unpaid',
      skip_reason: null,
      route_position: 1,
      completed_at: null,
    });
    expect(visit?.customer_name).toBe('Jane Smith');
    expect(visit?.quoted_amount).toBe(12);
    expect(visit?.lat).toBe(51.5);
  });
});

function visit(overrides: Partial<VisitRow>): VisitRow {
  return {
    id: '1',
    reference_number: 'R-AAAAAA-20260918',
    customer_id: 'c',
    customer_name: 'Jane',
    service_agreement_id: 'a',
    agreement_occurrence_date: '2026-09-18',
    address: '12 Elm Road',
    postcode: 'SW1A 1AA',
    lat: null,
    lng: null,
    job_description: 'Window clean',
    status: 'assigned',
    scheduled_date: '2026-09-18',
    scheduled_time: null,
    estimated_duration_minutes: 20,
    quoted_amount: 15,
    final_amount: null,
    payment_status: 'unpaid',
    skip_reason: null,
    route_position: null,
    completed_at: null,
    ...overrides,
  };
}

describe('summariseTodayVisits', () => {
  it('sums planned £ excluding skipped, and flags unordered leftover stops', () => {
    const summary = summariseTodayVisits([
      visit({ id: '1', status: 'completed', quoted_amount: 15, route_position: 1 }),
      visit({ id: '2', status: 'assigned', quoted_amount: 18, route_position: null }),
      visit({ id: '3', status: 'cancelled', quoted_amount: 12, skip_reason: 'no_access' }),
    ]);
    expect(summary.todayDone).toBe(1);
    expect(summary.todayPlannedAmount).toBe(33);
    expect(summary.unorderedToday).toBe(true);
  });

  it('does not treat a fully ordered leftover list as unordered', () => {
    const summary = summariseTodayVisits([
      visit({ id: '1', status: 'assigned', route_position: 1 }),
      visit({ id: '2', status: 'assigned', route_position: 2 }),
    ]);
    expect(summary.unorderedToday).toBe(false);
  });
});
