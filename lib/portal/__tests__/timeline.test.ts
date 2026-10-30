import { describe, expect, it } from 'vitest';
import { buildTimeline } from '../timeline';

const base = { createdAt: '2026-10-30T06:03:00Z', arrivedAt: null, history: [] };
const labels = (events: ReturnType<typeof buildTimeline>) => events.map((e) => e.label);

describe('buildTimeline', () => {
  it('adds accepted from the last change while the job is still accepted', () => {
    const events = buildTimeline({
      ...base,
      status: 'accepted',
      updatedAt: '2026-10-30T09:40:00Z',
      history: [{ id: 'h1', from_status: 'pending', to_status: 'assigned', created_at: '2026-10-30T06:03:00Z' }],
    });
    expect(labels(events)).toEqual(['Job raised', 'Engineer assigned', 'Engineer accepted the job']);
  });

  it('does not guess when the job has moved on past accepted', () => {
    const events = buildTimeline({ ...base, status: 'in_progress', updatedAt: '2026-10-30T09:51:00Z' });
    expect(labels(events)).not.toContain('Engineer accepted the job');
  });

  it('fills in started and completed from the job when the history has neither', () => {
    const events = buildTimeline({
      ...base,
      status: 'completed',
      arrivedAt: '2026-10-30T09:51:00Z',
      startedAt: '2026-10-30T09:55:00Z',
      completedAt: '2026-10-30T10:30:00Z',
    });
    expect(labels(events)).toEqual(['Job raised', 'Engineer arrived', 'Work started', 'Completed']);
  });

  it('lists arriving and starting once when the phone stamps both together', () => {
    const events = buildTimeline({
      ...base,
      status: 'in_progress',
      arrivedAt: '2026-10-30T09:51:00Z',
      startedAt: '2026-10-30T09:51:00Z',
    });
    expect(labels(events)).toEqual(['Job raised', 'Engineer arrived']);
  });

  it('does not repeat a step the history already has', () => {
    const events = buildTimeline({
      ...base,
      status: 'completed',
      completedAt: '2026-10-30T10:30:00Z',
      history: [{ id: 'h2', from_status: 'in_progress', to_status: 'completed', created_at: '2026-10-30T10:30:00Z' }],
    });
    expect(labels(events).filter((l) => l === 'Completed')).toHaveLength(1);
  });
});
