/**
 * Cookie-free funnel events from the marketing site and the sign-up pages.
 * This file is the pure part: what an event looks like, how a public request is cleaned before it is stored,
 * and how stored events are added up for /admin/website. Nothing here touches the database.
 */

export const EVENT_KINDS = ['view', 'scroll', 'click', 'leave', 'signup'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export type SiteEvent = {
  visit: string;
  kind: EventKind;
  page: string;
  ad_source: string | null;
  ad_content: string | null;
  detail: string | null;
  value: number | null;
};

const VISIT = /^[a-z0-9-]{8,40}$/i;
const PAGE = /^\/[a-z0-9/_\-.]{0,100}$/i;
const SLUG = /^[a-z0-9][a-z0-9_-]{0,49}$/i;
const DETAIL = /^[a-z0-9 /_\-.:#]{1,80}$/i;
const SCROLL_STEPS = new Set([25, 50, 75, 100]);
/** Anyone leaving after longer than this is counted as 10 minutes: a tab left open, not reading. */
const MAX_SECONDS = 600;

/** Sites allowed to report to us. The app itself reports the sign-up steps. */
const ALLOWED_HOSTS = new Set(['joinworkwise.com', 'www.joinworkwise.com', 'app.joinworkwise.com']);

export function originAllowed(origin: string | null): boolean {
  if (!origin) return false;
  try {
    return ALLOWED_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/** Crawlers and scripts are not visitors. */
export function looksLikeBot(userAgent: string | null): boolean {
  if (!userAgent) return true;
  return /bot|crawl|spider|slurp|headless|lighthouse|preview|monitor|curl|wget|python|node-fetch/i.test(userAgent);
}

function clean(value: unknown, pattern: RegExp): string | null {
  return typeof value === 'string' && pattern.test(value) ? value : null;
}

/** Turns an untrusted request body into an event to store, or null if it isn't one we recognise. */
export function parseSiteEvent(body: unknown): SiteEvent | null {
  if (!body || typeof body !== 'object') return null;
  const raw = body as Record<string, unknown>;

  const visit = clean(raw.visit, VISIT);
  const page = clean(raw.page, PAGE);
  const kind = EVENT_KINDS.find((k) => k === raw.kind);
  if (!visit || !page || !kind) return null;

  const detail = clean(raw.detail, DETAIL);
  const number = typeof raw.value === 'number' && Number.isFinite(raw.value) ? Math.round(raw.value) : null;

  let value: number | null = null;
  if (kind === 'scroll') {
    if (number === null || !SCROLL_STEPS.has(number)) return null;
    value = number;
  } else if (kind === 'leave') {
    if (number === null || number < 0) return null;
    value = Math.min(number, MAX_SECONDS);
  } else if (kind === 'click' || kind === 'signup') {
    if (!detail) return null;
  }

  return {
    visit,
    kind,
    page,
    ad_source: clean(raw.ad_source, SLUG),
    ad_content: clean(raw.ad_content, SLUG),
    detail,
    value,
  };
}

// ---------------------------------------------------------------------------------------------
// Adding events up
// ---------------------------------------------------------------------------------------------

export type StoredEvent = Pick<SiteEvent, 'visit' | 'kind' | 'page' | 'ad_content' | 'detail' | 'value'>;

/** The sign-up step names the sign-up pages send, in the order a person meets them. */
export const SIGNUP_STEPS = ['plan', 'details', 'submitted'] as const;

export type PageRow = {
  page: string;
  views: number;
  /** Median seconds on the page, from the visits that reported leaving. null = no data yet. */
  seconds: number | null;
  /** Share of views, 0-1. */
  scrolled50: number;
  scrolled100: number;
  clickedStart: number;
  /** Most pressed links on the page, other than Start. */
  topLinks: { label: string; count: number }[];
};

export type Funnel = {
  views: number;
  clickedStart: number;
  plan: number;
  details: number;
  submitted: number;
};

export type SiteSummary = {
  /** Distinct ad names seen, most views first, so the panel can offer a filter. */
  ads: string[];
  pages: PageRow[];
  funnel: Funnel;
};

/** The label stored when someone presses a link to the sign-up pages. */
export const START_LABEL = 'start';

function median(numbers: number[]): number | null {
  if (numbers.length === 0) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** `ad` null = everyone; 'organic' = visits with no ad tag; anything else = that ad's name. */
export function summariseSiteEvents(events: StoredEvent[], ad: string | null): SiteSummary {
  const adViews = new Map<string, number>();
  for (const e of events) {
    if (e.kind === 'view' && e.ad_content) adViews.set(e.ad_content, (adViews.get(e.ad_content) ?? 0) + 1);
  }
  const ads = [...adViews.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);

  const inScope = events.filter((e) => {
    if (ad === null) return true;
    if (ad === 'organic') return !e.ad_content;
    return e.ad_content === ad;
  });

  type Bucket = {
    visits: Set<string>;
    seconds: Map<string, number>;
    s50: Set<string>;
    s100: Set<string>;
    start: Set<string>;
    links: Map<string, Set<string>>;
  };
  const buckets = new Map<string, Bucket>();
  const bucket = (page: string): Bucket => {
    let b = buckets.get(page);
    if (!b) {
      b = { visits: new Set(), seconds: new Map(), s50: new Set(), s100: new Set(), start: new Set(), links: new Map() };
      buckets.set(page, b);
    }
    return b;
  };

  const signup: Record<string, Set<string>> = { plan: new Set(), details: new Set(), submitted: new Set() };
  const marketingVisits = new Set<string>();
  const startVisits = new Set<string>();

  for (const e of inScope) {
    if (e.page.startsWith('/signup')) {
      if (e.kind === 'signup' && e.detail && signup[e.detail]) signup[e.detail].add(e.visit);
      continue;
    }
    const b = bucket(e.page);
    if (e.kind === 'view') {
      b.visits.add(e.visit);
      marketingVisits.add(e.visit);
    } else if (e.kind === 'leave' && e.value !== null) {
      // A visit can report more than once (tab hidden, then closed); its longest report is its time on the page.
      b.seconds.set(e.visit, Math.max(b.seconds.get(e.visit) ?? 0, e.value));
    } else if (e.kind === 'scroll') {
      if (e.value !== null && e.value >= 50) b.s50.add(e.visit);
      if (e.value === 100) b.s100.add(e.visit);
    } else if (e.kind === 'click' && e.detail) {
      if (e.detail === START_LABEL) {
        b.start.add(e.visit);
        startVisits.add(e.visit);
      } else {
        const who = b.links.get(e.detail) ?? new Set<string>();
        who.add(e.visit);
        b.links.set(e.detail, who);
      }
    }
  }

  const pages: PageRow[] = [...buckets.entries()]
    .filter(([, b]) => b.visits.size > 0)
    .map(([page, b]) => {
      const views = b.visits.size;
      return {
        page,
        views,
        seconds: median([...b.seconds.values()]),
        scrolled50: b.s50.size / views,
        scrolled100: b.s100.size / views,
        clickedStart: b.start.size / views,
        topLinks: [...b.links.entries()]
          .map(([label, who]) => ({ label, count: who.size }))
          .sort((x, y) => y.count - x.count || x.label.localeCompare(y.label))
          .slice(0, 3),
      };
    })
    .sort((a, b) => b.views - a.views || a.page.localeCompare(b.page));

  return {
    ads,
    pages,
    funnel: {
      views: marketingVisits.size,
      clickedStart: startVisits.size,
      plan: signup.plan.size,
      details: signup.details.size,
      submitted: signup.submitted.size,
    },
  };
}
