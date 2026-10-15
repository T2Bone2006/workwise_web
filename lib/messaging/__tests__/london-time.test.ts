import { describe, expect, it } from 'vitest';
import {
  isQuietHours,
  londonHour,
  londonMonth,
  londonWallTimeToUtc,
  sendableFrom,
} from '@/lib/messaging/london-time';

describe('londonWallTimeToUtc', () => {
  it('is DST-safe for summer, winter and clocks-change days', () => {
    expect(londonWallTimeToUtc('2026-07-01', 7, 0).toISOString()).toBe(
      '2026-07-01T06:00:00.000Z',
    );
    expect(londonWallTimeToUtc('2026-12-01', 7, 0).toISOString()).toBe(
      '2026-12-01T07:00:00.000Z',
    );
    expect(londonWallTimeToUtc('2026-03-29', 7, 0).toISOString()).toBe(
      '2026-03-29T06:00:00.000Z',
    );
    expect(londonWallTimeToUtc('2026-10-25', 7, 0).toISOString()).toBe(
      '2026-10-25T07:00:00.000Z',
    );
  });
});

describe('londonHour / londonMonth', () => {
  it('reads London wall-clock parts', () => {
    // 2026-07-01 12:00 London = 11:00 UTC
    const noonBst = new Date('2026-07-01T11:00:00.000Z');
    expect(londonHour(noonBst)).toBe(12);
    expect(londonMonth(noonBst)).toBe('2026-07');
  });
});

describe('isQuietHours / sendableFrom', () => {
  it('holds texts from 21:00 until 07:00 London', () => {
    // 20:59 London BST = 19:59 UTC
    const before = new Date('2026-07-01T19:59:00.000Z');
    expect(londonHour(before)).toBe(20);
    expect(isQuietHours(before)).toBe(false);
    expect(sendableFrom(before)).toBe(before);

    // 21:00 London BST = 20:00 UTC → next day 07:00 = 06:00Z
    const atStart = new Date('2026-07-01T20:00:00.000Z');
    expect(londonHour(atStart)).toBe(21);
    expect(isQuietHours(atStart)).toBe(true);
    expect(sendableFrom(atStart).toISOString()).toBe('2026-07-02T06:00:00.000Z');

    // 02:30 London BST = 01:30 UTC → same day 07:00 = 06:00Z
    const night = new Date('2026-07-01T01:30:00.000Z');
    expect(londonHour(night)).toBe(2);
    expect(sendableFrom(night).toISOString()).toBe('2026-07-01T06:00:00.000Z');

    // 07:00 London BST = 06:00 UTC → unchanged
    const seven = new Date('2026-07-01T06:00:00.000Z');
    expect(londonHour(seven)).toBe(7);
    expect(isQuietHours(seven)).toBe(false);
    expect(sendableFrom(seven)).toBe(seven);
  });
});
