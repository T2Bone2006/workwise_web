import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MESSAGING_SETTINGS,
  parseMessagingSettings,
  withMessagingSettings,
} from '@/lib/messaging/settings';

describe('parseMessagingSettings', () => {
  it('returns defaults for missing or junk input', () => {
    expect(parseMessagingSettings(undefined)).toEqual(DEFAULT_MESSAGING_SETTINGS);
    expect(parseMessagingSettings(null)).toEqual(DEFAULT_MESSAGING_SETTINGS);
    expect(parseMessagingSettings('nope')).toEqual(DEFAULT_MESSAGING_SETTINGS);
  });

  it('falls back reminder_days_before to rounds, then clamps 1..7', () => {
    expect(
      parseMessagingSettings({}, { reminder_days_before: 5 }).reminder_days_before,
    ).toBe(5);
    expect(parseMessagingSettings({ reminder_days_before: 0 }).reminder_days_before).toBe(
      1,
    );
    expect(
      parseMessagingSettings({ reminder_days_before: 14 }).reminder_days_before,
    ).toBe(7);
  });

  it('corrects chase_second_days when it is not after chase_first_days', () => {
    expect(
      parseMessagingSettings({ chase_first_days: 10, chase_second_days: 8 })
        .chase_second_days,
    ).toBe(24);
  });

  it('keeps contact_phone only when it normalises to a UK number', () => {
    expect(parseMessagingSettings({ contact_phone: '07700 900123' }).contact_phone).toBe(
      '+447700900123',
    );
    expect(parseMessagingSettings({ contact_phone: 'not-a-phone' }).contact_phone).toBeNull();
  });
});

describe('withMessagingSettings', () => {
  it('writes messaging without touching other keys', () => {
    expect(
      withMessagingSettings({ rounds: { horizon_weeks: 8 } }, DEFAULT_MESSAGING_SETTINGS),
    ).toEqual({
      rounds: { horizon_weeks: 8 },
      messaging: DEFAULT_MESSAGING_SETTINGS,
    });
  });
});
