import { describe, expect, it } from 'vitest';
import { summarisePeople } from '../site-people';
import type { StoredEvent } from '../site-events';

function ev(person: string | null, visit: string, kind: StoredEvent['kind'], page: string, extra: Partial<StoredEvent> = {}): StoredEvent {
  return { person, visit, kind, page, ad_content: 'rounds', detail: null, value: null, created_at: '2026-11-05T10:00:00Z', ...extra };
}

const events: StoredEvent[] = [
  // Person A: home -> pricing -> Start -> sign-up plan -> details, then quiet
  ev('pa', 'a1', 'view', '/'),
  ev('pa', 'a1', 'leave', '/', { value: 14 }),
  ev('pa', 'a2', 'view', '/pricing'),
  ev('pa', 'a2', 'click', '/pricing', { detail: 'start' }),
  ev('pa', 'a2', 'leave', '/pricing', { value: 40 }),
  ev('pa', 's1', 'signup', '/signup', { detail: 'plan' }),
  ev('pa', 's1', 'signup', '/signup', { detail: 'details' }),
  // Person B: home only, comes back another day
  ev('pb', 'b1', 'view', '/'),
  ev('pb', 'b1', 'leave', '/', { value: 5 }),
  ev('pb', 'b2', 'view', '/', { created_at: '2026-11-06T09:00:00Z' }),
  // Person C: home -> pricing, then leaves
  ev('pc', 'c1', 'view', '/'),
  ev('pc', 'c2', 'view', '/pricing'),
  // Not followed: no person code
  ev(null, 'x1', 'view', '/'),
];

describe('summarisePeople', () => {
  const s = summarisePeople(events, null);

  it('ignores visits with no person code', () => {
    expect(s.people).toBe(3);
  });

  it('counts people, not page visits', () => {
    expect(s.funnel).toEqual({ opened: 3, pressedStart: 1, plan: 1, details: 1, submitted: 0 });
    expect(s.returning).toBe(1);
  });

  it('shows where people went straight after each page', () => {
    const home = s.next.find((n) => n.page === 'Home page');
    expect(home?.people).toBe(3); // A -> pricing, B reloaded then left, C -> pricing
    expect(home?.to).toEqual([
      { label: '/pricing', count: 2 },
      { label: 'Left the site', count: 1 },
    ]);
    const pricing = s.next.find((n) => n.page === '/pricing');
    expect(pricing?.to).toEqual([
      { label: 'Left the site', count: 1 },
      { label: 'Sign-up page', count: 1 },
    ]);
  });

  it('says what each person did last', () => {
    expect(s.lastStops).toEqual([
      { label: '/pricing', count: 1 },
      { label: 'Details form', count: 1 },
      { label: 'Home page', count: 1 },
    ]);
  });

  it('tells a journey as a short story with time on each page', () => {
    const a = s.journeys.find((j) => j.steps.includes('Details form'));
    expect(a?.steps).toEqual(['Home page (14s)', '/pricing (40s)', 'Pressed Start', 'Plan choice', 'Details form']);
    expect(a?.ad).toBe('rounds');
  });

  it('puts the most recent person first', () => {
    expect(s.journeys[0].steps[0]).toBe('Home page');
    expect(s.journeys).toHaveLength(3);
  });

  it('can be limited to one ad or to no ad', () => {
    expect(summarisePeople(events, 'lite').people).toBe(0);
    expect(summarisePeople(events, 'organic').people).toBe(0);
    expect(summarisePeople(events, 'rounds').people).toBe(3);
  });

  it('is empty with no followed visitors', () => {
    expect(summarisePeople([], null)).toEqual({
      people: 0,
      returning: 0,
      funnel: { opened: 0, pressedStart: 0, plan: 0, details: 0, submitted: 0 },
      next: [],
      lastStops: [],
      journeys: [],
    });
  });
});
