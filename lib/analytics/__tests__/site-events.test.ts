import { describe, expect, it } from 'vitest';
import {
  biggestLeak,
  funnelSteps,
  looksLikeBot,
  originAllowed,
  parseSiteEvent,
  summariseSiteEvents,
  verdict,
  type Funnel,
  type StoredEvent,
} from '../site-events';

describe('parseSiteEvent', () => {
  const base = { visit: 'abc12345-def', page: '/pricing', kind: 'view' };

  it('keeps a clean page view and the ad tags', () => {
    expect(parseSiteEvent({ ...base, ad_source: 'facebook', ad_content: 'rounds' })).toEqual({
      visit: 'abc12345-def',
      kind: 'view',
      page: '/pricing',
      ad_source: 'facebook',
      ad_content: 'rounds',
      detail: null,
      value: null,
      person: null,
    });
  });

  it('drops tags that are not short slugs', () => {
    const event = parseSiteEvent({ ...base, ad_content: '<script>alert(1)</script>', ad_source: 'a b' });
    expect(event?.ad_content).toBeNull();
    expect(event?.ad_source).toBeNull();
  });

  it('keeps a clean person code and drops a bad one', () => {
    expect(parseSiteEvent({ ...base, person: '3f2b8c1e-9d4a-4e6b-8a1c-5d7e9f0a1b2c' })?.person).toBe('3f2b8c1e-9d4a-4e6b-8a1c-5d7e9f0a1b2c');
    expect(parseSiteEvent({ ...base, person: 'x y' })?.person).toBeNull();
    expect(parseSiteEvent(base)?.person).toBeNull();
  });

  it('refuses things that are not events', () => {
    expect(parseSiteEvent(null)).toBeNull();
    expect(parseSiteEvent('hello')).toBeNull();
    expect(parseSiteEvent({ ...base, kind: 'purchase' })).toBeNull();
    expect(parseSiteEvent({ ...base, page: 'https://evil.example/' })).toBeNull();
    expect(parseSiteEvent({ ...base, visit: 'x' })).toBeNull();
  });

  it('only takes scroll steps we measure', () => {
    expect(parseSiteEvent({ ...base, kind: 'scroll', value: 50 })?.value).toBe(50);
    expect(parseSiteEvent({ ...base, kind: 'scroll', value: 51 })).toBeNull();
    expect(parseSiteEvent({ ...base, kind: 'scroll' })).toBeNull();
  });

  it('caps time on page at ten minutes', () => {
    expect(parseSiteEvent({ ...base, kind: 'leave', value: 9000 })?.value).toBe(600);
    expect(parseSiteEvent({ ...base, kind: 'leave', value: -3 })).toBeNull();
  });

  it('needs a label for clicks and sign-up steps', () => {
    expect(parseSiteEvent({ ...base, kind: 'click' })).toBeNull();
    expect(parseSiteEvent({ ...base, kind: 'click', detail: 'start' })?.detail).toBe('start');
    expect(parseSiteEvent({ ...base, page: '/signup', kind: 'signup' })).toBeNull();
    expect(parseSiteEvent({ ...base, page: '/signup', kind: 'signup', detail: 'details' })?.detail).toBe('details');
  });
});

describe('originAllowed / looksLikeBot', () => {
  it('only our own sites may report', () => {
    expect(originAllowed('https://joinworkwise.com')).toBe(true);
    expect(originAllowed('https://app.joinworkwise.com')).toBe(true);
    expect(originAllowed('https://joinworkwise.com.evil.example')).toBe(false);
    expect(originAllowed('http://localhost:3100')).toBe(false);
    expect(originAllowed(null)).toBe(false);
  });

  it('skips crawlers and scripts', () => {
    expect(looksLikeBot('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true);
    expect(looksLikeBot('curl/8.0')).toBe(true);
    expect(looksLikeBot(null)).toBe(true);
    expect(looksLikeBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1')).toBe(false);
  });
});

function ev(visit: string, kind: StoredEvent['kind'], page: string, extra: Partial<StoredEvent> = {}): StoredEvent {
  return { visit, kind, page, ad_content: null, detail: null, value: null, ...extra };
}

describe('summariseSiteEvents', () => {
  const events: StoredEvent[] = [
    // Visit a (rounds ad): reads the whole page, presses Start
    ev('a', 'view', '/', { ad_content: 'rounds' }),
    ev('a', 'scroll', '/', { ad_content: 'rounds', value: 25 }),
    ev('a', 'scroll', '/', { ad_content: 'rounds', value: 50 }),
    ev('a', 'scroll', '/', { ad_content: 'rounds', value: 100 }),
    ev('a', 'click', '/', { ad_content: 'rounds', detail: 'start' }),
    ev('a', 'leave', '/', { ad_content: 'rounds', value: 40 }),
    // Visit b (rounds ad): leaves quickly
    ev('b', 'view', '/', { ad_content: 'rounds' }),
    ev('b', 'leave', '/', { ad_content: 'rounds', value: 4 }),
    // Visit c (lite ad): looks at pricing link
    ev('c', 'view', '/', { ad_content: 'lite' }),
    ev('c', 'click', '/', { ad_content: 'lite', detail: 'link /pricing' }),
    // Visit d: no ad
    ev('d', 'view', '/pricing'),
    // Sign-up pages
    ev('s1', 'signup', '/signup', { detail: 'plan' }),
    ev('s1', 'signup', '/signup', { detail: 'details' }),
    ev('s2', 'signup', '/signup', { detail: 'plan' }),
  ];

  it('adds up one page for everyone', () => {
    const summary = summariseSiteEvents(events, null);
    const home = summary.pages.find((p) => p.page === '/');
    expect(home?.views).toBe(3);
    expect(home?.scrolled50).toBeCloseTo(1 / 3);
    expect(home?.scrolled100).toBeCloseTo(1 / 3);
    expect(home?.clickedStart).toBeCloseTo(1 / 3);
    expect(home?.seconds).toBe(22);
    expect(home?.topLinks).toEqual([{ label: 'link /pricing', count: 1 }]);
    expect(summary.ads).toEqual(['rounds', 'lite']);
  });

  it('counts the funnel from page view to sign-up steps', () => {
    expect(summariseSiteEvents(events, null).funnel).toEqual({
      views: 4,
      clickedStart: 1,
      plan: 2,
      details: 1,
      submitted: 0,
    });
  });

  it('filters to one ad, and to visits with no ad', () => {
    expect(summariseSiteEvents(events, 'lite').pages).toHaveLength(1);
    expect(summariseSiteEvents(events, 'rounds').funnel.views).toBe(2);
    const organic = summariseSiteEvents(events, 'organic');
    expect(organic.pages.map((p) => p.page)).toEqual(['/pricing']);
  });

  it('counts a visit once for time on page, using its longest report', () => {
    const twice: StoredEvent[] = [
      ev('a', 'view', '/'),
      ev('a', 'leave', '/', { value: 5 }),
      ev('a', 'leave', '/', { value: 30 }),
      ev('b', 'view', '/'),
      ev('b', 'leave', '/', { value: 10 }),
    ];
    expect(summariseSiteEvents(twice, null).pages[0].seconds).toBe(20);
  });

  it('is empty when nothing has happened', () => {
    expect(summariseSiteEvents([], null)).toEqual({
      ads: [],
      pages: [],
      funnel: { views: 0, clickedStart: 0, plan: 0, details: 0, submitted: 0 },
    });
  });
});

describe('plain-words summary', () => {
  const funnel = (over: Partial<Funnel>): Funnel => ({ views: 0, clickedStart: 0, plan: 0, details: 0, submitted: 0, ...over });

  it('says it is too early when there are few visits', () => {
    const v = verdict(funnel({ views: 12, clickedStart: 3 }));
    expect(v.tone).toBe('amber');
    expect(v.text).toContain('Too early to tell');
    expect(v.text).toContain('12 page visits');
  });

  it('works out "out of every 100" against the first step', () => {
    const steps = funnelSteps(funnel({ views: 200, clickedStart: 20, plan: 10, details: 8, submitted: 2 }));
    expect(steps.map((s) => s.per100)).toEqual([100, 10, 5, 4, 1]);
    expect(steps[1].kept).toBeCloseTo(0.1);
  });

  it('names the step where most people stop', () => {
    const f = funnel({ views: 200, clickedStart: 40, plan: 36, details: 10, submitted: 9 });
    expect(biggestLeak(funnelSteps(f))?.label).toBe('Filled in their details');
    expect(verdict(f).text).toContain('Out of every 100 page visits, 20 press Start and 5 get as far as paying.');
    expect(verdict(f).text).toContain('After pressing Start, most people give up between "Saw the plan choice" and "Filled in their details"');
  });

  it('ignores steps too small to judge, and a step that has more than the one before', () => {
    expect(biggestLeak(funnelSteps(funnel({ views: 100, clickedStart: 5, plan: 4, details: 1, submitted: 0 })))).toBeNull();
    expect(biggestLeak(funnelSteps(funnel({ views: 400, clickedStart: 40, plan: 8, details: 7, submitted: 6 })))?.label).toBe('Saw the plan choice');
    const odd = funnelSteps(funnel({ views: 100, clickedStart: 5, plan: 9 }));
    expect(odd[2].kept).toBe(1);
  });
});
