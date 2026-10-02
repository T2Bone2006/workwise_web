import { describe, expect, it } from 'vitest';
import type { ComingUp, ComingUpWeek } from '@/lib/rounds/coming-up';
import { roomDetail, roomForWork, roomHeadline } from '@/lib/rounds/room-for-work';

// 2026-10-06 is a Tuesday, 2026-10-08 a Thursday.
function week(weekStart: string, spareDays: string[], stops = 10): ComingUpWeek {
  return { weekStart, weekEnd: weekStart, label: '', stops, amount: 0, spareDays, workingDays: 5, forecastStops: 0, days: [] };
}
function view(weeks: ComingUpWeek[]): ComingUp {
  return {
    weeks,
    totalStops: weeks.reduce((s, w) => s + w.stops, 0),
    totalAmount: 0,
    totalSpareDays: weeks.reduce((s, w) => s + w.spareDays.length, 0),
  };
}

describe('roomForWork', () => {
  it('is empty when nothing is booked or scheduled', () => {
    expect(roomForWork(view([week('2026-10-05', [], 0)]))).toEqual({ kind: 'empty' });
  });

  it('says fully booked when no working day is free', () => {
    const room = roomForWork(view([week('2026-10-05', []), week('2026-10-12', []), week('2026-10-19', []), week('2026-10-26', [])]));
    expect(room).toEqual({ kind: 'full', weeks: 4 });
    expect(roomHeadline(room as never)).toBe("You're fully booked for the next 4 weeks.");
  });

  it('names the weekdays that are free in most weeks', () => {
    const room = roomForWork(
      view([
        week('2026-10-05', ['2026-10-06', '2026-10-08']),
        week('2026-10-12', ['2026-10-13', '2026-10-15']),
        week('2026-10-19', ['2026-10-20', '2026-10-22']),
        week('2026-10-26', ['2026-10-27']),
      ]),
    );
    if (room.kind !== 'room') throw new Error('expected room');
    expect(room.regularWeekdays).toEqual([2, 4]);
    expect(room.spareDays).toBe(7);
    expect(room.nextDays).toEqual(['2026-10-06', '2026-10-08', '2026-10-13']);
    expect(roomHeadline(room)).toBe('You could fit another customer in on Tuesdays and Thursdays.');
    expect(roomDetail(room)).toBe(
      '7 free working days in the next 4 weeks. The soonest are Tue 6 Oct, Thu 8 Oct and Tue 13 Oct.',
    );
  });

  it('falls back to a plain line when the free days follow no pattern', () => {
    const room = roomForWork(
      view([week('2026-10-05', ['2026-10-06']), week('2026-10-12', ['2026-10-15']), week('2026-10-19', []), week('2026-10-26', [])]),
    );
    if (room.kind !== 'room') throw new Error('expected room');
    expect(room.regularWeekdays).toEqual([]);
    expect(roomHeadline(room)).toBe("You've got a few free days coming up.");
  });

  it('says "day" and "is" for a single free day', () => {
    const room = roomForWork(view([week('2026-10-05', ['2026-10-06']), week('2026-10-12', []), week('2026-10-19', []), week('2026-10-26', [])]));
    if (room.kind !== 'room') throw new Error('expected room');
    expect(roomDetail(room)).toBe('1 free working day in the next 4 weeks. The soonest is Tue 6 Oct.');
  });

  it('only looks at the first 4 weeks of a 12-week view', () => {
    const weeks = Array.from({ length: 12 }, (_, i) => week(`w${i}`, i < 4 ? [] : ['2026-11-03']));
    expect(roomForWork(view(weeks))).toEqual({ kind: 'full', weeks: 4 });
  });
});
