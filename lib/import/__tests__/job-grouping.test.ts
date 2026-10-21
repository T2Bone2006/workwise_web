import { describe, expect, it } from 'vitest';
import { computeRowGroups, groupingMatchValue } from '@/lib/import/job-grouping';

const COLS = ['BR NAME', 'DATE & TIME - START'] as const;

describe('groupingMatchValue', () => {
  it('treats a date-and-time and an ISO date as the same day', () => {
    expect(groupingMatchValue('03/09/2026 09:00')).toBe('2026-09-03');
    expect(groupingMatchValue('2026-09-03')).toBe('2026-09-03');
    expect(groupingMatchValue('27/10/2026 08:30')).toBe(groupingMatchValue('27/10/2026 09:30'));
  });

  it('leaves bare numbers alone so a job ref cannot become a day', () => {
    expect(groupingMatchValue('45000')).toBe('45000');
    expect(groupingMatchValue('45000.5')).toBe('45000.5');
    expect(groupingMatchValue('45000')).not.toBe(groupingMatchValue('45000.5'));
  });

  it('still matches names without caring about capitals or extra spaces', () => {
    expect(groupingMatchValue('  Tahir   Mahmood ')).toBe('tahir mahmood');
  });
});

describe('computeRowGroups', () => {
  it('groups one officer on one day when the clock times differ', () => {
    const rows = [
      { 'BR NAME': 'Pavandeep Rai', 'DATE & TIME - START': '27/10/2026 08:30' },
      { 'BR NAME': 'Pavandeep Rai', 'DATE & TIME - START': '27/10/2026 09:30' },
      { 'BR NAME': 'tahir mahmood', 'DATE & TIME - START': '29/10/2026 09:50' },
      { 'BR NAME': 'tahir mahmood', 'DATE & TIME - START': '29/10/2026 10:50' },
      { 'BR NAME': 'Neil Robbins', 'DATE & TIME - START': '22/10/2026 09:00' },
      { 'BR NAME': 'Neil Robbins', 'DATE & TIME - START': '26/10/2026 13:00' },
      { 'BR NAME': 'Neil Robbins', 'DATE & TIME - START': '27/10/2026 13:00' },
      { 'BR NAME': 'Neil Robbins', 'DATE & TIME - START': '28/10/2026 13:30' },
    ];

    const groups = computeRowGroups(rows, COLS);

    expect(groups.map((g) => [g.label, g.rowIndexes])).toEqual([
      ['Pavandeep Rai · 27/10/2026', [0, 1]],
      ['tahir mahmood · 29/10/2026', [2, 3]],
    ]);
  });

  it('groups the same day written as ISO and as a UK date with a time', () => {
    const rows = [
      { 'BR NAME': 'tahir mahmood', 'DATE & TIME - START': '2026-09-03' },
      { 'BR NAME': 'tahir mahmood', 'DATE & TIME - START': '03/09/2026 09:00' },
      { 'BR NAME': 'Richard Lewis', 'DATE & TIME - START': '03/09/2026 09:00' },
      { 'BR NAME': 'Richard Lewis', 'DATE & TIME - START': '03/09/2026 11:30' },
    ];

    const groups = computeRowGroups(rows, COLS);

    expect(groups.map((g) => [g.label, g.rowIndexes])).toEqual([
      ['tahir mahmood · 03/09/2026', [0, 1]],
      ['Richard Lewis · 03/09/2026', [2, 3]],
    ]);
  });

  it('does not merge different numeric refs that share an Excel serial day', () => {
    const rows = [
      { ref: '45000' },
      { ref: '45000' },
      { ref: '45000.5' },
      { ref: '45000.5' },
    ];

    const groups = computeRowGroups(rows, ['ref']);

    expect(groups.map((g) => [g.label, g.rowIndexes])).toEqual([
      ['45000', [0, 1]],
      ['45000.5', [2, 3]],
    ]);
  });

  it('does not make a group out of one row, and skips rows with every value blank', () => {
    const rows = [
      { 'BR NAME': 'Neil Robbins', 'DATE & TIME - START': '22/10/2026 09:00' },
      { 'BR NAME': '', 'DATE & TIME - START': '' },
      { 'BR NAME': '', 'DATE & TIME - START': '' },
    ];

    expect(computeRowGroups(rows, COLS)).toEqual([]);
    expect(computeRowGroups(rows, [])).toEqual([]);
  });
});
