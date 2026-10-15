import { describe, expect, it } from 'vitest';
import { formatOffRange, groupOffWarnings } from '../off-warning';

const s = (workerId: string, workerName: string, date: string, visitCount: number) => ({ workerId, workerName, date, visitCount });

describe('formatOffRange', () => {
  it('one day, a range in a month, and across months', () => {
    expect(formatOffRange('2026-10-12', '2026-10-12')).toBe('Mon 12 Oct');
    expect(formatOffRange('2026-10-12', '2026-10-13')).toBe('Mon 12 – Tue 13 Oct');
    expect(formatOffRange('2026-10-30', '2026-11-02')).toBe('Fri 30 Oct – Mon 2 Nov');
  });
});

describe('groupOffWarnings', () => {
  it('says it plainly for one day', () => {
    const [w] = groupOffWarnings([s('w1', 'Dave', '2026-10-12', 9)], 'wo');
    expect(w!.text).toBe('Dave is off Mon 12 Oct but has 9 stops that day.');
  });

  it('adds up a range into one warning per person', () => {
    const [w] = groupOffWarnings([s('w1', 'Dave', '2026-10-12', 9), s('w1', 'Dave', '2026-10-13', 5)], 'wo');
    expect(w!.text).toBe('Dave is off Mon 12 – Tue 13 Oct but has 14 stops on those days.');
    expect(w!.totalStops).toBe(14);
    expect(w!.days).toHaveLength(2);
  });

  it('gives each person their own, and speaks to the owner as you', () => {
    const out = groupOffWarnings([s('w1', 'Dave', '2026-10-13', 2), s('wo', 'Test Owner', '2026-10-12', 1)], 'wo');
    expect(out.map((w) => w.text)).toEqual([
      'You are off Mon 12 Oct but have 1 stop that day.',
      'Dave is off Tue 13 Oct but has 2 stops that day.',
    ]);
    expect(out[0]!.isOwner).toBe(true);
  });

  it('ignores days with nothing left to do', () => {
    expect(groupOffWarnings([s('w1', 'Dave', '2026-10-12', 0)], 'wo')).toEqual([]);
  });
});
