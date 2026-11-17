import { describe, expect, it } from 'vitest';
import { offersFor } from '@/components/settings/plan-billing/change-plan-options';

describe('offersFor with the founder price', () => {
  const rounds = { plan: 'rounds', interval: 'month' } as const;

  it('shows the half-price figures to a founder', () => {
    const offers = offersFor(rounds, '2026-12-17T00:00:00Z', false, true);
    expect(offers.find((o) => o.title === 'Add Lite')?.price).toBe('+£12 a month');
    expect(offers.find((o) => o.title === 'Switch to yearly')?.detail).toBe('2 months free: £175 a year instead of £210.');
  });

  it('keeps the list figures for everyone else', () => {
    const offers = offersFor(rounds, '2026-12-17T00:00:00Z', false, false);
    expect(offers.find((o) => o.title === 'Add Lite')?.price).toBe('+£24 a month');
    expect(offers.find((o) => o.title === 'Switch to yearly')?.detail).toBe('2 months free: £350 a year instead of £420.');
  });
});
