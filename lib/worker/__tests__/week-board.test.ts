import { describe, expect, it } from 'vitest';
import type { WorkerJob } from '@/lib/worker/types';
import {
  buildWorkerWeeks,
  extendWeekRange,
  formatWorkerBoardDay,
  shownBoardDays,
  weekBoardRange,
} from '@/lib/worker/week-board';

function job(partial: Partial<WorkerJob> & Pick<WorkerJob, 'id' | 'scheduledDate'>): WorkerJob {
  return {
    referenceNumber: null,
    title: 'Lock change',
    status: 'assigned',
    priority: 'normal',
    scheduledTime: null,
    address: null,
    postcode: null,
    customerName: null,
    completedAt: null,
    notBecause: null,
    ...partial,
  };
}

const TODAY = '2026-10-08';

describe('weekBoardRange', () => {
  it('opens on the same six weeks as the Rounds board', () => {
    expect(weekBoardRange(TODAY)).toEqual({ from: '2026-09-21', weeks: 6, to: '2026-11-01' });
  });
  it('steps two weeks and never holds more than sixteen', () => {
    expect(extendWeekRange({ from: '2026-09-21', weeks: 6 }, 'later')).toEqual({ from: '2026-09-21', weeks: 8 });
    expect(extendWeekRange({ from: '2026-09-21', weeks: 6 }, 'earlier')).toEqual({ from: '2026-09-07', weeks: 8 });
    expect(extendWeekRange({ from: '2026-09-21', weeks: 16 }, 'later')).toEqual({ from: '2026-10-05', weeks: 16 });
    expect(extendWeekRange({ from: '2026-09-21', weeks: 16 }, 'earlier')).toEqual({ from: '2026-09-07', weeks: 16 });
  });
});

describe('buildWorkerWeeks', () => {
  const jobs = [
    job({
      id: 'later',
      scheduledDate: TODAY,
      scheduledTime: '14:00',
      customerName: 'Ada',
      address: '1 High Street, Town',
      postcode: 'AB1 2CD',
      status: 'accepted',
    }),
    job({ id: 'early', scheduledDate: TODAY, scheduledTime: '09:00', status: 'completed', title: 'Gain entry' }),
    job({ id: 'sat', scheduledDate: '2026-10-10', customerName: 'Weekend' }),
    job({ id: 'declined', scheduledDate: TODAY, status: 'declined' }),
    job({ id: 'undated', scheduledDate: null }),
    job({ id: 'urgent', scheduledDate: '2026-10-09', priority: 'emergency', status: 'assigned' }),
  ];

  const week = buildWorkerWeeks({ jobs, from: TODAY, weeks: 1, today: TODAY })[0]!;

  it('labels the week and the day the same way as Rounds', () => {
    expect(week.weekStart).toBe('2026-10-05');
    expect(week.label).toBe('w/c 5 Oct');
    expect(formatWorkerBoardDay(TODAY)).toBe('Thu 8 Oct');
  });

  it('puts Monday to Friday on the board and leaves the weekend off it', () => {
    const shown = shownBoardDays(week.days);
    expect(shown.map((day) => day.date)).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
    ]);
    expect(week.days.find((day) => day.date === '2026-10-10')?.jobs.map((card) => card.id)).toEqual(['sat']);
    expect(shown.some((day) => day.jobs.some((card) => card.id === 'sat'))).toBe(false);
  });

  it('orders a day by time, skips declined and undated jobs, and counts what is done', () => {
    const thursday = week.days.find((day) => day.date === TODAY)!;
    expect(thursday.isToday).toBe(true);
    expect(thursday.total).toBe(2);
    expect(thursday.done).toBe(1);
    expect(thursday.jobs.map((card) => card.id)).toEqual(['early', 'later']);
    expect(thursday.jobs[1]).toMatchObject({
      name: 'Ada',
      street: '1 High Street',
      postcode: 'AB1 2CD',
      title: 'Lock change',
      time: '14:00',
      state: 'planned',
      tag: 'Accepted',
    });
    expect(thursday.jobs[0]).toMatchObject({ state: 'done', tag: 'Done' });
  });

  it('marks an urgent job and a past day', () => {
    const friday = week.days.find((day) => day.date === '2026-10-09')!;
    expect(friday.jobs[0]).toMatchObject({ id: 'urgent', urgent: true, tag: 'Waiting for you' });
    expect(week.days.find((day) => day.date === '2026-10-07')?.isPast).toBe(true);
  });
});
