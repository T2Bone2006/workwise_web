import { describe, expect, it } from 'vitest';
import { planLabel, summariseLite, type SubscriptionRow } from '@/lib/data/admin-website';

function sub(over: Partial<SubscriptionRow>): SubscriptionRow {
  return {
    tenant_id: 't1',
    product: 'lite',
    plan: 'lite',
    status: 'active',
    source: 'stripe',
    billing_interval: 'month',
    created_at: '2026-11-10T09:00:00Z',
    cancel_at_period_end: false,
    canceled_at: null,
    current_period_end: '2026-12-10T09:00:00Z',
    ...over,
  };
}

describe('planLabel', () => {
  it('names the plan', () => {
    expect(planLabel([sub({ product: 'lite' })])).toBe('Lite');
    expect(planLabel([sub({ product: 'rounds', plan: 'rounds' })])).toBe('Rounds');
    expect(planLabel([sub({ product: 'growth', plan: 'growth' })])).toBe('Pro Growth');
  });
  it('calls Rounds and Lite together the bundle', () => {
    expect(planLabel([sub({ product: 'rounds' }), sub({ product: 'lite' })])).toBe('Rounds + Lite');
    expect(planLabel([sub({ product: 'lite', plan: 'both' })])).toBe('Rounds + Lite');
  });
});

describe('summariseLite', () => {
  it('is null when they never had Lite', () => {
    expect(summariseLite([sub({ product: 'rounds' })])).toBeNull();
    expect(summariseLite([sub({ source: 'manual' })])).toBeNull();
  });
  it('is active while paying, with the keep date 12 months from the start', () => {
    const lite = summariseLite([sub({})]);
    expect(lite?.state).toBe('active');
    expect(lite?.startedAt).toBe('2026-11-10T09:00:00Z');
    expect(lite?.keepFrom).toBe('2027-11-10T09:00:00.000Z');
  });
  it('is ending when set to cancel at the period end', () => {
    const lite = summariseLite([sub({ cancel_at_period_end: true })]);
    expect(lite?.state).toBe('ending');
    expect(lite?.endsAt).toBe('2026-12-10T09:00:00Z');
  });
  it('is ended once cancelled, ending when it was cancelled', () => {
    const lite = summariseLite([sub({ status: 'canceled', canceled_at: '2027-01-05T00:00:00Z' })]);
    expect(lite?.state).toBe('ended');
    expect(lite?.endsAt).toBe('2027-01-05T00:00:00Z');
  });
  it('counts from the first Lite row when there are several', () => {
    const lite = summariseLite([
      sub({ created_at: '2027-03-01T00:00:00Z' }),
      sub({ created_at: '2026-11-10T09:00:00Z', status: 'canceled', canceled_at: '2027-02-01T00:00:00Z' }),
    ]);
    expect(lite?.startedAt).toBe('2026-11-10T09:00:00Z');
    expect(lite?.state).toBe('active');
  });
});
