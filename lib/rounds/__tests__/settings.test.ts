import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUNDS_SETTINGS, parseRoundsSettings, withRoundsSettings } from '@/lib/rounds/settings';

describe('parseRoundsSettings', () => {
  it('returns defaults for missing or junk input', () => {
    expect(parseRoundsSettings(undefined)).toEqual(DEFAULT_ROUNDS_SETTINGS);
    expect(parseRoundsSettings(null)).toEqual(DEFAULT_ROUNDS_SETTINGS);
    expect(parseRoundsSettings('nope')).toEqual(DEFAULT_ROUNDS_SETTINGS);
    expect(parseRoundsSettings([])).toEqual(DEFAULT_ROUNDS_SETTINGS);
  });

  it('accepts the JSON signup already writes for a Rounds tenant', () => {
    // provision_tenant_from_intent: horizon 8, reminder 3, Mon–Fri. No blackouts/start.
    expect(
      parseRoundsSettings({
        horizon_weeks: 8,
        reminder_days_before: 3,
        working_days: [1, 2, 3, 4, 5],
      })
    ).toEqual({
      horizon_weeks: 8,
      reminder_days_before: 3,
      working_days: [1, 2, 3, 4, 5],
      blackouts: [],
      shift_off_non_working_days: false,
      start_postcode: null,
    });
  });

  it('fills only the invalid fields and keeps the rest', () => {
    expect(
      parseRoundsSettings({
        horizon_weeks: 99,
        reminder_days_before: 2,
        working_days: [7],
        blackouts: ['2026-12-25'],
        start_postcode: 'SW1A 1AA',
      })
    ).toEqual({
      horizon_weeks: 8,
      reminder_days_before: 2,
      working_days: [7],
      blackouts: ['2026-12-25'],
      shift_off_non_working_days: false,
      start_postcode: 'SW1A 1AA',
    });
  });

  it('sorts, dedupes and clamps working days; empty falls back to Mon–Fri', () => {
    expect(parseRoundsSettings({ working_days: [5, 1, 1, 9, 3] }).working_days).toEqual([
      1, 3, 5,
    ]);
    expect(parseRoundsSettings({ working_days: [] }).working_days).toEqual([1, 2, 3, 4, 5]);
    expect(parseRoundsSettings({ working_days: ['2', '7'] }).working_days).toEqual([2, 7]);
  });

  it('sorts and drops invalid blackout dates', () => {
    expect(
      parseRoundsSettings({
        blackouts: ['2026-12-26', 'not-a-date', '2026-12-25', '2026-12-25', '2026-02-30'],
      }).blackouts
    ).toEqual(['2026-12-25', '2026-12-26']);
  });

  it('clamps horizon to 1..12 and reminder to 0..14', () => {
    expect(parseRoundsSettings({ horizon_weeks: 0 }).horizon_weeks).toBe(8);
    expect(parseRoundsSettings({ horizon_weeks: 1 }).horizon_weeks).toBe(1);
    expect(parseRoundsSettings({ horizon_weeks: 12 }).horizon_weeks).toBe(12);
    expect(parseRoundsSettings({ reminder_days_before: -1 }).reminder_days_before).toBe(3);
    expect(parseRoundsSettings({ reminder_days_before: 0 }).reminder_days_before).toBe(0);
    expect(parseRoundsSettings({ reminder_days_before: 14 }).reminder_days_before).toBe(14);
  });

  it('treats blank start postcode as null', () => {
    expect(parseRoundsSettings({ start_postcode: '  ' }).start_postcode).toBeNull();
    expect(parseRoundsSettings({ start_postcode: null }).start_postcode).toBeNull();
  });

  it('defaults shift_off_non_working_days to false and only turns on when opted in', () => {
    expect(parseRoundsSettings({}).shift_off_non_working_days).toBe(false);
    expect(parseRoundsSettings({ shift_off_non_working_days: true }).shift_off_non_working_days).toBe(
      true
    );
    expect(parseRoundsSettings({ shift_off_non_working_days: 'nope' }).shift_off_non_working_days).toBe(
      false
    );
  });

  it('does not mutate the defaults object', () => {
    const parsed = parseRoundsSettings(undefined);
    parsed.working_days.push(6);
    parsed.blackouts.push('2026-01-01');
    expect(DEFAULT_ROUNDS_SETTINGS.working_days).toEqual([1, 2, 3, 4, 5]);
    expect(DEFAULT_ROUNDS_SETTINGS.blackouts).toEqual([]);
  });
});

describe('withRoundsSettings', () => {
  it('writes rounds without dropping other tenant settings keys', () => {
    const next = withRoundsSettings(
      {
        company: { phone: '07700900123' },
        features: { pro: true },
        rounds: { horizon_weeks: 4 },
      },
      DEFAULT_ROUNDS_SETTINGS,
    );
    expect(next.company).toEqual({ phone: '07700900123' });
    expect(next.features).toEqual({ pro: true });
    expect(next.rounds).toEqual(DEFAULT_ROUNDS_SETTINGS);
  });
});
