import { describe, expect, it } from 'vitest';
import {
  FREQUENCY_PRESETS,
  frequencyLabel,
  parseFrequencyDays,
} from '@/lib/rounds/parse-frequency';

describe('parseFrequencyDays — named phrases', () => {
  it.each([
    ['weekly', 7],
    ['Weekly', 7],
    ['every weekly', 7],
    ['fortnightly', 14],
    ['fortnight', 14],
    ['two weekly', 14],
    ['two-weekly', 14],
    ['2 weekly', 14],
    ['monthly', 28],
    ['4 weekly', 28],
    ['4-weekly', 28],
    ['every 4 weeks', 28],
    ['6 weekly', 42],
    ['8 weekly', 56],
    ['quarterly', 91],
    ['twice yearly', 182],
    ['twice a year', 182],
    ['6 monthly', 182],
    ['6-monthly', 182],
    ['yearly', 365],
    ['annual', 365],
    ['annually', 365],
    ['every year', 365],
  ] as const)('%s → %i days', (raw, days) => {
    expect(parseFrequencyDays(raw)).toBe(days);
  });
});

describe('parseFrequencyDays — N weeks / days / months', () => {
  it.each([
    ['6w', 42],
    ['6 w', 42],
    ['3 weeks', 21],
    ['1 week', 7],
    ['52 weeks', 364],
    ['28 days', 28],
    ['28d', 28],
    ['1 day', 1],
    ['3 months', 84],
    ['1 month', 28],
    ['6m', 168],
    ['13 months', 364],
  ] as const)('%s → %i days', (raw, days) => {
    expect(parseFrequencyDays(raw)).toBe(days);
  });
});

describe('parseFrequencyDays — bare numbers', () => {
  it('≤ 12 means weeks', () => {
    expect(parseFrequencyDays(1)).toBe(7);
    expect(parseFrequencyDays(4)).toBe(28);
    expect(parseFrequencyDays(12)).toBe(84);
    expect(parseFrequencyDays('4')).toBe(28);
    expect(parseFrequencyDays(' 12 ')).toBe(84);
  });

  it('13..365 means days', () => {
    expect(parseFrequencyDays(13)).toBe(13);
    expect(parseFrequencyDays(28)).toBe(28);
    expect(parseFrequencyDays('28')).toBe(28);
    expect(parseFrequencyDays(365)).toBe(365);
  });
});

describe('parseFrequencyDays — unreadable / out of range', () => {
  it('returns null', () => {
    expect(parseFrequencyDays(null)).toBeNull();
    expect(parseFrequencyDays(undefined)).toBeNull();
    expect(parseFrequencyDays('')).toBeNull();
    expect(parseFrequencyDays('   ')).toBeNull();
    expect(parseFrequencyDays('sometimes')).toBeNull();
    expect(parseFrequencyDays(0)).toBeNull();
    expect(parseFrequencyDays(-7)).toBeNull();
    expect(parseFrequencyDays(366)).toBeNull();
    expect(parseFrequencyDays(53)).toBe(53);
    expect(parseFrequencyDays('53 weeks')).toBeNull();
    expect(parseFrequencyDays('14 months')).toBeNull();
    expect(parseFrequencyDays(4.5)).toBeNull();
    expect(parseFrequencyDays(Number.NaN)).toBeNull();
  });
});

describe('frequencyLabel', () => {
  it('uses the named labels from the spec', () => {
    expect(frequencyLabel(7)).toBe('Weekly');
    expect(frequencyLabel(14)).toBe('Fortnightly');
    expect(frequencyLabel(28)).toBe('Every 4 weeks');
    expect(frequencyLabel(30)).toBe('Every 30 days');
  });

  it('labels week multiples and calendar presets', () => {
    expect(frequencyLabel(21)).toBe('Every 3 weeks');
    expect(frequencyLabel(42)).toBe('Every 6 weeks');
    expect(frequencyLabel(91)).toBe('Quarterly');
    expect(frequencyLabel(182)).toBe('Twice yearly');
    expect(frequencyLabel(365)).toBe('Yearly');
  });
});

describe('FREQUENCY_PRESETS', () => {
  it('is 7, 14, 21, 28, 42, 56, 84, 91, 182, 365 with matching labels', () => {
    expect(FREQUENCY_PRESETS.map((p) => p.days)).toEqual([
      7, 14, 21, 28, 42, 56, 84, 91, 182, 365,
    ]);
    for (const preset of FREQUENCY_PRESETS) {
      expect(preset.label).toBe(frequencyLabel(preset.days));
    }
  });
});
