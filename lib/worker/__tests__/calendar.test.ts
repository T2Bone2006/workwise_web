import { describe, expect, it } from 'vitest';
import { calendarRange, monthGridDays, parseCalendarParams, stepDate } from '@/lib/worker/calendar';

describe('parseCalendarParams', () => {
  const today = '2026-10-08';
  it('defaults to the month view on today', () => {
    expect(parseCalendarParams({}, today)).toEqual({ view: 'month', date: today });
  });
  it('accepts the day view and a real date', () => {
    expect(parseCalendarParams({ view: 'day', date: '2026-12-25' }, today)).toEqual({ view: 'day', date: '2026-12-25' });
  });
  it('accepts the week view', () => {
    expect(parseCalendarParams({ view: 'week', date: '2026-10-08' }, today)).toEqual({ view: 'week', date: '2026-10-08' });
  });
  it('falls back for nonsense, including impossible dates and an unknown view', () => {
    expect(parseCalendarParams({ view: 'year', date: 'nonsense' }, today)).toEqual({ view: 'month', date: today });
    expect(parseCalendarParams({ date: '2026-02-30' }, today).date).toBe(today);
    expect(parseCalendarParams({ date: ['2026-10-01'] }, today).date).toBe(today);
  });
});

describe('monthGridDays', () => {
  it('starts on the Monday on or before the 1st and ends on a Sunday', () => {
    const days = monthGridDays('2026-10-08'); // 1 Oct 2026 is a Thursday
    expect(days[0]).toBe('2026-09-28');
    expect(days.at(-1)).toBe('2026-11-01');
    expect(days).toHaveLength(35);
  });
  it('uses six weeks when the month needs them', () => {
    const days = monthGridDays('2026-08-15'); // 1 Aug 2026 is a Saturday, 31 days
    expect(days[0]).toBe('2026-07-27');
    expect(days.at(-1)).toBe('2026-09-06');
    expect(days).toHaveLength(42);
  });
  it('is exactly four weeks for a February that starts on a Monday', () => {
    const days = monthGridDays('2027-02-10'); // 1 Feb 2027 is a Monday, 28 days
    expect(days[0]).toBe('2027-02-01');
    expect(days.at(-1)).toBe('2027-02-28');
    expect(days).toHaveLength(28);
  });
});

describe('calendarRange / stepDate', () => {
  it('fetches one day in the day view and the whole grid in the month view', () => {
    expect(calendarRange('day', '2026-10-08')).toEqual({ from: '2026-10-08', to: '2026-10-08' });
    expect(calendarRange('week', '2026-10-08')).toEqual({ from: '2026-09-21', to: '2026-11-01' });
    expect(calendarRange('month', '2026-10-08')).toEqual({ from: '2026-09-28', to: '2026-11-01' });
  });
  it('steps a day, or a whole month without skipping short ones', () => {
    expect(stepDate('week', '2026-10-08', 1)).toBe('2026-10-15');
    expect(stepDate('week', '2026-10-08', -1)).toBe('2026-10-01');
    expect(stepDate('day', '2026-10-31', 1)).toBe('2026-11-01');
    expect(stepDate('day', '2026-10-01', -1)).toBe('2026-09-30');
    expect(stepDate('month', '2026-01-31', 1)).toBe('2026-02-01');
    expect(stepDate('month', '2026-03-31', -1)).toBe('2026-02-01');
    expect(stepDate('month', '2026-12-15', 1)).toBe('2027-01-01');
  });
});
