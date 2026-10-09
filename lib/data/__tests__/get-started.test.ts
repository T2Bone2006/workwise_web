import { describe, expect, it } from 'vitest';
import { getStartedFrom } from '@/lib/data/get-started-core';

const base = { isAdmin: true, stripeBilledPro: true, teamCount: 0, customerCount: 0, jobCount: 0, expectedWorkers: undefined as unknown };

describe('getStartedFrom', () => {
  it('shows a fresh Stripe-billed Pro business with all three steps open', () => {
    const s = getStartedFrom(base);
    expect(s.show).toBe(true);
    expect(s.steps.team.done).toBe(false);
    expect(s.steps.customers.done).toBe(false);
    expect(s.steps.jobs.done).toBe(false);
  });

  it('ticks a step as soon as there is one of it, and keeps showing until all three are done', () => {
    const s = getStartedFrom({ ...base, teamCount: 40, customerCount: 200 });
    expect(s.show).toBe(true);
    expect(s.steps.team).toEqual({ done: true, count: 40 });
    expect(s.steps.customers).toEqual({ done: true, count: 200 });
    expect(s.steps.jobs.done).toBe(false);
  });

  it('hides once all three are done', () => {
    expect(getStartedFrom({ ...base, teamCount: 1, customerCount: 1, jobCount: 1 }).show).toBe(false);
  });

  it('hides from non-admins and from manual or non-Pro businesses', () => {
    expect(getStartedFrom({ ...base, isAdmin: false }).show).toBe(false);
    expect(getStartedFrom({ ...base, stripeBilledPro: false }).show).toBe(false);
  });

  it('keeps only a whole number from 1 to 999 as the expected workers', () => {
    expect(getStartedFrom({ ...base, expectedWorkers: 40 }).expectedWorkers).toBe(40);
    for (const bad of [0, 1000, 'abc', 12.5, null, undefined, -3, '40']) {
      expect(getStartedFrom({ ...base, expectedWorkers: bad }).expectedWorkers).toBeNull();
    }
  });
});
