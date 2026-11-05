import { describe, expect, it } from 'vitest';
import { looksLikeBot, originAllowed, parseSiteEvent, summariseSiteEvents, type StoredEvent } from '../site-events';

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
    });
  });

  it('drops tags that are not short slugs', () => {
    const event = parseSiteEvent({ ...base, ad_content: '<script>alert(1)</script>', ad_source: 'a b' });
    expect(event?.ad_content).toBeNull();
    expect(event?.ad_source).toBeNull();
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
