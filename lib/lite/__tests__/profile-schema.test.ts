import { describe, expect, it } from 'vitest';
import { parseProfile, type PriceProfile } from '@/lib/lite/profile-schema';

function profile(overrides: Partial<PriceProfile> = {}): PriceProfile {
  return {
    areas: { summary: 'South Manchester', postcodes: ['M14'], max_miles: 12 },
    callout_fee: 40,
    hourly_rate: null,
    day_rate: null,
    minimum_charge: 60,
    materials: 'Customer buys the lock',
    job_types: [
      {
        key: 'lock-change',
        name: 'Lock change',
        how_priced: 'from_description',
        guide_min: 70,
        guide_max: 120,
        what_changes_price: 'The kind of lock',
        auto_accept: false,
      },
    ],
    rules: ['No Sundays'],
    example_jobs: [{ description: 'Yale night latch', price: 85, reasoning: 'Standard cylinder' }],
    tone: 'Warm and brief',
    ...overrides,
  };
}

describe('parseProfile', () => {
  it('accepts a complete price profile', () => {
    expect(parseProfile(profile())).toEqual(profile());
  });

  it('returns null for a broken stored profile, so the bot stays in enquiry mode', () => {
    expect(parseProfile(null)).toBeNull();
    expect(parseProfile({})).toBeNull();
    expect(parseProfile({ ...profile(), job_types: [] })).toBeNull();
    expect(parseProfile('not json')).toBeNull();
  });

  it('requires a range for work priced from a description, and unique keys', () => {
    const missingRange = profile();
    missingRange.job_types[0] = { ...missingRange.job_types[0], guide_min: null, guide_max: null };
    expect(parseProfile(missingRange)).toBeNull();

    const upsideDown = profile();
    upsideDown.job_types[0] = { ...upsideDown.job_types[0], guide_min: 120, guide_max: 70 };
    expect(parseProfile(upsideDown)).toBeNull();

    const duplicate = profile({
      job_types: [
        profile().job_types[0],
        { ...profile().job_types[0], name: 'Lock change again' },
      ],
    });
    expect(parseProfile(duplicate)).toBeNull();
  });

  it('allows auto-accept only for work priced from a description', () => {
    const visit = profile({
      job_types: [
        {
          key: 'ceiling-skim',
          name: 'Ceiling skim',
          how_priced: 'needs_visit',
          guide_min: 200,
          guide_max: 450,
          what_changes_price: 'How big the room is',
          auto_accept: true,
        },
      ],
    });
    expect(parseProfile(visit)).toBeNull();

    const accepted = profile();
    accepted.job_types[0] = { ...accepted.job_types[0], auto_accept: true };
    expect(parseProfile(accepted)?.job_types[0].auto_accept).toBe(true);
  });
});
