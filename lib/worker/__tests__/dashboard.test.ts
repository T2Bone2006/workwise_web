import { describe, expect, it } from 'vitest';
import { buildDashboard, dashboardWindow, greetingFor, weekStart } from '@/lib/worker/dashboard';
import type { WorkerJob } from '@/lib/worker/types';

const job = (over: Partial<WorkerJob>): WorkerJob => ({
  id: Math.random().toString(36).slice(2),
  referenceNumber: null,
  title: 'Job',
  status: 'accepted',
  priority: 'normal',
  scheduledDate: '2026-10-08',
  scheduledTime: '09:00',
  address: null,
  postcode: null,
  customerName: null,
  completedAt: null,
  notBecause: null,
  ...over,
});

describe('greetingFor', () => {
  it('follows the time of day and uses the first name when there is one', () => {
    expect(greetingFor(8, 'Sam')).toBe('Good morning, Sam');
    expect(greetingFor(12, null)).toBe('Good afternoon');
    expect(greetingFor(17, 'Sam')).toBe('Good afternoon, Sam');
    expect(greetingFor(18, 'Sam')).toBe('Good evening, Sam');
    expect(greetingFor(23, null)).toBe('Good evening');
  });
});

describe('weekStart', () => {
  it('is the Monday of that week, including for a Sunday and a Monday', () => {
    expect(weekStart('2026-10-08')).toBe('2026-10-05'); // Thursday
    expect(weekStart('2026-10-05')).toBe('2026-10-05'); // Monday
    expect(weekStart('2026-10-11')).toBe('2026-10-05'); // Sunday
  });
});

describe('dashboardWindow', () => {
  it('reaches back to the start of the month or two weeks, whichever is earlier, and 30 days on', () => {
    expect(dashboardWindow('2026-10-08')).toEqual({ from: '2026-09-24', to: '2026-11-07' });
    expect(dashboardWindow('2026-10-20')).toEqual({ from: '2026-10-01', to: '2026-11-19' });
  });
});

describe('buildDashboard', () => {
  const today = '2026-10-08';
  const jobs = [
    job({ id: 'a', scheduledDate: today, status: 'completed' }),
    job({ id: 'b', scheduledDate: today, status: 'accepted', scheduledTime: '14:00' }),
    job({ id: 'c', scheduledDate: '2026-10-02', status: 'completed' }),
    job({ id: 'd', scheduledDate: '2026-09-20', status: 'completed' }),
    job({ id: 'e', scheduledDate: '2026-10-03', status: 'incomplete' }),
    job({ id: 'f', scheduledDate: '2026-10-09', status: 'accepted' }),
    job({ id: 'g', scheduledDate: '2026-10-20', status: 'assigned' }),
    job({ id: 'h', scheduledDate: '2026-10-21', status: 'declined' }),
  ];
  const data = buildDashboard(jobs, today);

  it("works out today's plan", () => {
    expect(data.today).toMatchObject({ total: 2, done: 1, remaining: 1 });
    expect(data.today.next?.id).toBe('b');
  });

  it('gives Monday to Sunday with today marked', () => {
    expect(data.week.map((d) => d.date)).toEqual([
      '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11',
    ]);
    expect(data.week.filter((d) => d.isToday).map((d) => d.date)).toEqual([today]);
    expect(data.week[0].isPast).toBe(true);
    expect(data.week[4].isPast).toBe(false);
  });

  it('counts this month, what is coming, and what was not completed lately', () => {
    expect(data.numbers.doneThisMonth).toBe(2); // a (today) and c (2 Oct); not d (September)
    expect(data.numbers.comingUp).toBe(2); // f and g; not the declined one
    expect(data.numbers.notCompletedRecently).toBe(1);
    expect(data.numbers.nextJobDate).toBe('2026-10-09');
  });

  it('has no next job date when nothing is coming', () => {
    expect(buildDashboard([], today).numbers).toEqual({
      doneThisMonth: 0,
      comingUp: 0,
      notCompletedRecently: 0,
      nextJobDate: null,
    });
  });
});
