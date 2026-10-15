import { describe, expect, it } from 'vitest';
import { visibleJobReportRows } from '@/lib/jobs/job-report-display';

const rsFields = [
  { id: 'customer_in', type: 'yes_no', label: 'Customer in?' },
  {
    id: 'lock_opened',
    type: 'yes_no',
    label: 'Did you pick, slip, or drill the lock?',
  },
  {
    id: 'lock_open_method',
    type: 'select',
    label: 'How was the lock opened?',
    options: ['Pick', 'Slip', 'Drill', 'Other'],
    show_when: { field: 'lock_opened', value: true },
  },
  {
    id: 'lock_open_method_other',
    type: 'text',
    label: 'How else was the lock opened?',
    show_when: { field: 'lock_open_method', value: 'Other' },
  },
  { id: 'lock_changed', type: 'yes_no', label: 'Was the lock changed?' },
  {
    id: 'walk_away',
    type: 'yes_no',
    label: 'Did you walk away?',
    blocks_completion: true,
  },
  {
    id: 'walk_away_detail',
    type: 'text',
    label: 'Reason for walkaway',
    multiline: true,
    show_when: { field: 'walk_away', value: true },
  },
];

describe('visibleJobReportRows', () => {
  it('returns nothing when the job has no report', () => {
    expect(visibleJobReportRows(null, rsFields)).toEqual([]);
    expect(visibleJobReportRows({}, rsFields)).toEqual([]);
    expect(visibleJobReportRows({ job_notes: 'Keys left', pause_reason: 'Lunch' }, rsFields)).toEqual([]);
  });

  it('lists every question that was on screen, including blanks, in settings order', () => {
    const rows = visibleJobReportRows(
      {
        job_completed: true,
        customer_in: true,
        lock_opened: false,
        lock_changed: false,
        walk_away: false,
        job_notes: 'All done',
      },
      rsFields
    );

    expect(rows.map((row) => [row.id, row.value])).toEqual([
      ['job_completed', 'Yes'],
      ['customer_in', 'Yes'],
      ['lock_opened', 'No'],
      ['lock_changed', 'No'],
      ['walk_away', 'No'],
    ]);
  });

  it('shows a follow-up only when its condition matches, and keeps a blank write-in visible', () => {
    const rows = visibleJobReportRows(
      { lock_opened: true, lock_open_method: 'Other' },
      rsFields
    );

    expect(rows.map((row) => [row.id, row.value])).toEqual([
      ['customer_in', '—'],
      ['lock_opened', 'Yes'],
      ['lock_open_method', 'Other'],
      ['lock_open_method_other', '—'],
      ['lock_changed', '—'],
      ['walk_away', '—'],
    ]);
  });

  it('asks for the incomplete reason when the job was not completed', () => {
    const rows = visibleJobReportRows({ job_completed: false, customer_in: false }, rsFields);
    expect(rows.slice(0, 2).map((row) => [row.id, row.value])).toEqual([
      ['job_completed', 'No'],
      ['incomplete_reason', '—'],
    ]);
  });

  it('uses the office walk-away edit, and reveals the reason from that answer', () => {
    const rows = visibleJobReportRows(
      {
        customer_in: true,
        walk_away: false,
        walked_away: true,
        walk_away_detail: 'Customer refused the price',
      },
      rsFields
    );
    const walk = rows.find((row) => row.id === 'walk_away');
    const detail = rows.find((row) => row.id === 'walk_away_detail');
    expect(walk?.value).toBe('Yes');
    expect(detail).toMatchObject({
      value: 'Customer refused the price',
      multiline: true,
    });
    expect(rows.some((row) => row.id === 'walked_away')).toBe(false);
  });

  it('keeps an answer whose question has since been removed from settings', () => {
    const rows = visibleJobReportRows(
      { customer_in: true, shutter_engineer: true },
      [{ id: 'customer_in', label: 'Customer in?' }]
    );
    expect(rows.map((row) => [row.label, row.value])).toEqual([
      ['Customer in?', 'Yes'],
      ['Shutter engineer', 'Yes'],
    ]);
  });

  it('keeps a stored start time, formatted, when settings no longer ask for it', () => {
    const rows = visibleJobReportRows(
      { customer_in: true, start_time: '2026-10-14T09:30:00.000Z' },
      [{ id: 'customer_in', label: 'Customer in?' }]
    );
    expect(rows.find((row) => row.id === 'start_time')).toMatchObject({
      label: 'Start time',
      value: expect.stringContaining('14 Oct 2026'),
    });
  });

  it('drops a malformed settings entry', () => {
    const rows = visibleJobReportRows({ customer_in: true }, [null, { id: 'customer_in' }, 'nope']);
    expect(rows).toEqual([{ id: 'customer_in', label: 'Customer in', value: 'Yes', multiline: false }]);
  });
});
