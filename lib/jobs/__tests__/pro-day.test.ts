import { describe, expect, it } from 'vitest';
import { namesLine, summariseDay, teamForDay, type DayJob } from '@/lib/jobs/pro-day';

const job = (status: string, workerId: string | null = null, reference = 'PT-1'): DayJob => ({
  id: `${status}-${workerId}-${reference}`,
  status,
  workerId,
  reference,
});

describe('summariseDay', () => {
  it('counts each state and leaves cancelled jobs out of the total', () => {
    const counts = summariseDay([
      job('completed'),
      job('completed'),
      job('in_progress'),
      job('paused'),
      job('assigned'),
      job('pending'),
      job('declined'),
      job('incomplete'),
      job('cancelled'),
    ]);
    expect(counts).toEqual({ total: 8, done: 2, onJob: 2, waiting: 3, notCompleted: 1, cancelled: 1 });
  });

  it('is all zero for a quiet day', () => {
    expect(summariseDay([])).toEqual({ total: 0, done: 0, onJob: 0, waiting: 0, notCompleted: 0, cancelled: 0 });
  });
});

describe('teamForDay', () => {
  const workers = [
    { id: 'a', name: 'Ann Lee' },
    { id: 'b', name: 'Bob Roy' },
    { id: 'c', name: 'Cat Fox' },
  ];

  it('puts whoever is on a job first, then the busiest, and keeps free workers', () => {
    const team = teamForDay(workers, [
      job('completed', 'a', 'PT-1'),
      job('assigned', 'a', 'PT-2'),
      job('in_progress', 'b', 'PT-3'),
    ]);
    expect(team.map((t) => t.name)).toEqual(['Bob Roy', 'Ann Lee', 'Cat Fox']);
    expect(team[0]).toMatchObject({ onJob: true, currentReference: 'PT-3', total: 1, done: 0 });
    expect(team[1]).toMatchObject({ onJob: false, total: 2, done: 1 });
    expect(team[2]).toMatchObject({ total: 0, done: 0, onJob: false, currentReference: null });
  });

  it('ignores cancelled jobs and jobs with no worker', () => {
    const team = teamForDay(workers, [job('cancelled', 'a'), job('pending', null)]);
    expect(team.every((t) => t.total === 0)).toBe(true);
  });
});

describe('namesLine', () => {
  it('uses first names and folds the rest into a count', () => {
    expect(namesLine([])).toBe('');
    expect(namesLine(['Tom Kowalski'])).toBe('Tom');
    expect(namesLine(['Tom Kowalski', 'Priya Shah'])).toBe('Tom and Priya');
    expect(namesLine(['Tom Kowalski', 'Priya Shah', 'Dave Mercer', 'Sean F'])).toBe('Tom, Priya and 2 more');
  });
});
