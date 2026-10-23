import { describe, expect, it } from 'vitest';
import { isWebsiteStatus, keepFromDate, shouldTakeDown } from '@/lib/website-offer';

const START = new Date('2026-11-10T09:00:00Z');

describe('keepFromDate', () => {
  it('is twelve calendar months after the start', () => {
    expect(keepFromDate(START).toISOString()).toBe('2027-11-10T09:00:00.000Z');
  });
  it('does not change the date it was given', () => {
    keepFromDate(START);
    expect(START.toISOString()).toBe('2026-11-10T09:00:00.000Z');
  });
});

describe('isWebsiteStatus', () => {
  it('accepts the five statuses only', () => {
    for (const s of ['needs', 'building', 'done', 'has_one', 'taken_down']) expect(isWebsiteStatus(s)).toBe(true);
    expect(isWebsiteStatus('live')).toBe(false);
    expect(isWebsiteStatus(null)).toBe(false);
  });
});

describe('shouldTakeDown', () => {
  const base = { liteStartedAt: START };
  it('never while Lite is running', () => {
    expect(shouldTakeDown({ ...base, status: 'done', lite: 'active', liteEndsAt: null })).toBe(false);
  });
  it('yes when Lite ended before 12 months and a site is live or building', () => {
    const ends = new Date('2027-02-01T00:00:00Z');
    expect(shouldTakeDown({ ...base, status: 'done', lite: 'ended', liteEndsAt: ends })).toBe(true);
    expect(shouldTakeDown({ ...base, status: 'building', lite: 'ended', liteEndsAt: ends })).toBe(true);
  });
  it('yes when Lite is set to end before 12 months', () => {
    const ends = new Date('2027-03-01T00:00:00Z');
    expect(shouldTakeDown({ ...base, status: 'done', lite: 'ending', liteEndsAt: ends })).toBe(true);
  });
  it('no when Lite ran 12 months or more before ending', () => {
    const ends = new Date('2027-11-10T09:00:00Z');
    expect(shouldTakeDown({ ...base, status: 'done', lite: 'ended', liteEndsAt: ends })).toBe(false);
    expect(shouldTakeDown({ ...base, status: 'done', lite: 'ending', liteEndsAt: new Date('2028-01-01T00:00:00Z') })).toBe(false);
  });
  it('no when there is no site to take down', () => {
    const ends = new Date('2027-02-01T00:00:00Z');
    for (const status of ['needs', 'has_one', 'taken_down'] as const) {
      expect(shouldTakeDown({ ...base, status, lite: 'ended', liteEndsAt: ends })).toBe(false);
    }
  });
  it('an ended Lite with no end date counts as ended at the start', () => {
    expect(shouldTakeDown({ ...base, status: 'done', lite: 'ended', liteEndsAt: null })).toBe(true);
  });
});
