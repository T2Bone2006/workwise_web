import { describe, expect, it } from 'vitest';
import { groupByDay, groupByMonth } from '@/lib/worker/group';
import type { WorkerJob } from '@/lib/worker/types';

function job(id: string, scheduledDate: string | null, extra: Partial<WorkerJob> = {}): WorkerJob {
  return {
    id,
    referenceNumber: null,
    title: id,
    status: 'accepted',
    priority: null,
    scheduledDate,
    scheduledTime: null,
    address: null,
    postcode: null,
    customerName: null,
    completedAt: null,
    notBecause: null,
    ...extra,
  };
}

describe('groupByDay', () => {
  it('names today and tomorrow, then dates', () => {
    const groups = groupByDay([job('a', '2026-10-23'), job('b', '2026-10-23'), job('c', '2026-10-24'), job('d', '2026-10-30')], '2026-10-23');
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Tomorrow', 'Fri 30 Oct']);
    expect(groups[0].jobs.map((j) => j.id)).toEqual(['a', 'b']);
  });

  it('puts jobs with no day last, in their own group', () => {
    const groups = groupByDay([job('a', null), job('b', '2026-10-24')], '2026-10-23');
    expect(groups.map((g) => g.label)).toEqual(['Tomorrow', 'No day set']);
  });

  it('is empty for no jobs', () => {
    expect(groupByDay([], '2026-10-23')).toEqual([]);
  });
});

describe('groupByMonth', () => {
  it('groups by month in the order given', () => {
    const groups = groupByMonth([job('a', '2026-10-20'), job('b', '2026-10-02'), job('c', '2026-09-30')]);
    expect(groups.map((g) => g.label)).toEqual(['October 2026', 'September 2026']);
    expect(groups[0].jobs).toHaveLength(2);
  });

  it('can group by the day a job was finished', () => {
    const groups = groupByMonth([job('a', '2026-09-30', { completedAt: '2026-10-01T09:00:00Z' })], 'completed');
    expect(groups.map((g) => g.label)).toEqual(['October 2026']);
  });

  it('falls back to the scheduled day when a done job has no finish time', () => {
    const groups = groupByMonth([job('a', '2026-09-30')], 'completed');
    expect(groups.map((g) => g.label)).toEqual(['September 2026']);
  });
});
