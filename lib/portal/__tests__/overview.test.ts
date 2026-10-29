import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, formatDay, weekStartOf } from '@/lib/portal/dates';
import { buildOverview, incompleteReason, type OverviewInput, type PortalJobRow } from '@/lib/portal/overview';
import { buildTimeline } from '@/lib/portal/timeline';

// Wednesday 28 October 2026.
const TODAY = '2026-10-28';

function job(over: Partial<PortalJobRow> & { id: string }): PortalJobRow {
  return {
    reference_number: over.id.toUpperCase(),
    address: '1 Test Street',
    status: 'assigned',
    scheduled_date: null,
    scheduled_time: null,
    completed_at: null,
    arrived_at: null,
    updated_at: null,
    industry_data: null,
    ...over,
  };
}

describe('portal dates', () => {
  it('finds the Monday of the week', () => {
    expect(weekStartOf('2026-10-28')).toBe('2026-10-26');
    expect(weekStartOf('2026-10-26')).toBe('2026-10-26');
    expect(weekStartOf('2026-11-01')).toBe('2026-10-26');
  });

  it('adds days across a month end', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(daysBetween('2026-10-26', '2026-10-28')).toBe(2);
  });

  it('formats a day', () => {
    expect(formatDay('2026-10-30')).toBe('Fri 30 Oct');
  });
});

function overview(parts: Partial<OverviewInput>, today = TODAY) {
  const input: OverviewInput = {
    rows: [],
    incomplete: [],
    overdue: [],
    incompleteTotal: parts.incomplete?.length ?? 0,
    overdueTotal: parts.overdue?.length ?? 0,
    ...parts,
  };
  return buildOverview(input, today);
}

describe('buildOverview', () => {
  it('puts not-completed jobs first, newest first, with the reason', () => {
    const incomplete = [
      job({ id: 'a', status: 'incomplete', updated_at: '2026-10-26T10:00:00Z', industry_data: { incomplete_reason: ' No access ' } }),
      job({ id: 'b', status: 'incomplete', updated_at: '2026-10-27T10:00:00Z' }),
    ];
    const data = overview({ incomplete });
    expect(data.attention.map((a) => a.id)).toEqual(['b', 'a']);
    expect(data.attention[1].reason).toBe('No access');
    expect(data.attention[0].kind).toBe('not_completed');
  });

  it('lists overdue jobs with the most recently missed first, so they can still be chased', () => {
    const overdue = [
      job({ id: 'late1', scheduled_date: '2026-10-27' }),
      job({ id: 'late3', scheduled_date: '2026-10-25', status: 'accepted' }),
    ];
    const data = overview({ overdue });
    expect(data.attention.map((a) => [a.id, a.daysLate])).toEqual([
      ['late1', 1],
      ['late3', 3],
    ]);
  });

  it('counts every job in the totals, not just the ones listed', () => {
    const overdue = Array.from({ length: 9 }, (_, i) => job({ id: `l${i}`, scheduled_date: '2026-10-20' }));
    const data = overview({ overdue, overdueTotal: 140, incompleteTotal: 12 });
    expect(data.attention).toHaveLength(3);
    expect(data.attentionTotal).toBe(152);
    expect(data.week.overdue).toBe(140);
    expect(data.week.notCompleted).toBe(12);
  });

  it('counts the week and the completion rate', () => {
    const rows = [
      job({ id: '1', scheduled_date: '2026-10-26', status: 'completed' }),
      job({ id: '2', scheduled_date: '2026-10-27', status: 'completed' }),
      job({ id: '3', scheduled_date: '2026-10-27', status: 'incomplete' }),
      job({ id: '4', scheduled_date: '2026-10-29', status: 'assigned' }),
      job({ id: '5', scheduled_date: '2026-10-29', status: 'cancelled' }),
      job({ id: '6', scheduled_date: '2026-10-10', status: 'completed' }),
    ];
    const data = overview({ rows });
    expect(data.week.booked).toBe(4);
    expect(data.week.done).toBe(2);
    expect(data.week.completionRate).toBe(75);
    expect(data.week.finishedLast30).toBe(4);
  });

  it('has no rate when nothing has finished', () => {
    const data = overview({ rows: [job({ id: '1', scheduled_date: '2026-10-29' })] });
    expect(data.week.completionRate).toBeNull();
  });
});

describe('incompleteReason', () => {
  it('ignores blanks and non-text', () => {
    expect(incompleteReason(null)).toBeNull();
    expect(incompleteReason({ incomplete_reason: '  ' })).toBeNull();
    expect(incompleteReason({ incomplete_reason: 4 })).toBeNull();
  });

  it('falls back to the walk-away explanation', () => {
    expect(incompleteReason({ job_completed: true, walk_away: true, walk_away_detail: ' Tenant refused entry ' })).toBe(
      'Tenant refused entry',
    );
    expect(incompleteReason({ incomplete_reason: 'No access', walk_away_detail: 'Other' })).toBe('No access');
  });
});

describe('buildTimeline', () => {
  it('reads oldest first, hides office steps and repeats', () => {
    const events = buildTimeline({
      createdAt: '2026-10-26T08:00:00Z',
      arrivedAt: '2026-10-27T13:48:00Z',
      history: [
        { id: 'h3', from_status: 'in_progress', to_status: 'completed', created_at: '2026-10-27T14:32:00Z' },
        { id: 'h1', from_status: null, to_status: 'pending_send', created_at: '2026-10-26T08:01:00Z' },
        { id: 'h2', from_status: 'assigned', to_status: 'in_progress', created_at: '2026-10-27T13:50:00Z' },
        { id: 'h2b', from_status: 'in_progress', to_status: 'in_progress', created_at: '2026-10-27T13:51:00Z' },
      ],
    });
    expect(events.map((e) => e.label)).toEqual(['Job raised', 'Engineer arrived', 'Work started', 'Completed']);
  });
});
