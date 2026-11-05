/**
 * Following one visitor through the site: only for people who pressed Accept on the cookie banner, whose events
 * carry a random "person" code. Pure functions, nothing here touches the database.
 * Events must come in oldest first (the order they happened).
 */
import { scopeEvents, type StoredEvent } from './site-events';

export type PeopleFunnel = { opened: number; pressedStart: number; plan: number; details: number; submitted: number };

export type NextPage = { page: string; people: number; to: { label: string; count: number }[] };

export type Journey = { ad: string | null; steps: string[]; days: number };

export type PeopleSummary = {
  /** Different people followed. */
  people: number;
  /** Of those, how many came back on a different day. */
  returning: number;
  funnel: PeopleFunnel;
  /** For the busiest pages: where people went straight after. */
  next: NextPage[];
  /** The last thing people did before they went quiet. */
  lastStops: { label: string; count: number }[];
  /** The most recent people, as a short story each. */
  journeys: Journey[];
};

export const LEFT_LABEL = 'Left the site';
export const SIGNUP_PAGE_LABEL = 'Sign-up page';
const STEP_LABEL: Record<string, string> = { plan: 'Plan choice', details: 'Details form', submitted: 'Pressed pay' };
const START_STEP = 'Pressed Start';
const MAX_STEPS = 10;
const JOURNEYS_SHOWN = 8;

export function pageLabel(page: string): string {
  return page === '/' ? 'Home page' : page;
}

type Stop = { label: string; seconds: number };

function top<T>(map: Map<T, number>, n: number): { key: T; count: number }[] {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)))
    .slice(0, n);
}

export function summarisePeople(events: StoredEvent[], ad: string | null): PeopleSummary {
  const mine = scopeEvents(events, ad).filter((e): e is StoredEvent & { person: string } => Boolean(e.person));

  const byPerson = new Map<string, (StoredEvent & { person: string })[]>();
  for (const e of mine) {
    const list = byPerson.get(e.person);
    if (list) list.push(e);
    else byPerson.set(e.person, [e]);
  }

  const funnel: PeopleFunnel = { opened: 0, pressedStart: 0, plan: 0, details: 0, submitted: 0 };
  const transitions = new Map<string, Map<string, number>>();
  const lastStops = new Map<string, number>();
  let returning = 0;
  const journeys: { lastIndex: number; journey: Journey }[] = [];

  const indexOf = new Map<StoredEvent, number>();
  mine.forEach((e, i) => indexOf.set(e, i));

  for (const [, list] of byPerson) {
    const steps: Stop[] = [];
    const stopOfVisit = new Map<string, Stop>();
    const startedVisits = new Set<string>();
    const signupVisits = new Set<string>();
    const flow: string[] = [];
    const days = new Set<string>();
    let opened = false;
    let start = false;
    const seen = { plan: false, details: false, submitted: false };

    for (const e of list) {
      if (e.created_at) days.add(e.created_at.slice(0, 10));

      if (e.kind === 'view' && !e.page.startsWith('/signup')) {
        const stop: Stop = { label: pageLabel(e.page), seconds: 0 };
        steps.push(stop);
        stopOfVisit.set(e.visit, stop);
        flow.push(stop.label);
        opened = true;
      } else if (e.kind === 'leave' && e.value !== null) {
        const stop = stopOfVisit.get(e.visit);
        if (stop) stop.seconds = Math.max(stop.seconds, e.value);
      } else if (e.kind === 'click' && e.detail === 'start' && !startedVisits.has(e.visit)) {
        startedVisits.add(e.visit);
        steps.push({ label: START_STEP, seconds: 0 });
        start = true;
      } else if (e.kind === 'signup' && e.detail && STEP_LABEL[e.detail]) {
        if (!signupVisits.has(e.visit)) {
          signupVisits.add(e.visit);
          flow.push(SIGNUP_PAGE_LABEL);
        }
        steps.push({ label: STEP_LABEL[e.detail], seconds: 0 });
        if (e.detail === 'plan') seen.plan = true;
        if (e.detail === 'details') seen.details = true;
        if (e.detail === 'submitted') seen.submitted = true;
      }
    }

    if (opened) funnel.opened += 1;
    if (start) funnel.pressedStart += 1;
    if (seen.plan) funnel.plan += 1;
    if (seen.details) funnel.details += 1;
    if (seen.submitted) funnel.submitted += 1;
    if (days.size > 1) returning += 1;

    for (let i = 0; i < flow.length; i++) {
      const from = flow[i];
      const to = i + 1 < flow.length ? flow[i + 1] : LEFT_LABEL;
      if (from === to) continue; // a reload isn't going anywhere
      const row = transitions.get(from) ?? new Map<string, number>();
      row.set(to, (row.get(to) ?? 0) + 1);
      transitions.set(from, row);
    }

    const last = steps[steps.length - 1];
    if (last) lastStops.set(last.label, (lastStops.get(last.label) ?? 0) + 1);

    const labels = steps.map((s) => (s.seconds > 0 ? `${s.label} (${s.seconds < 60 ? `${s.seconds}s` : `${Math.round(s.seconds / 60)}m`})` : s.label));
    journeys.push({
      lastIndex: Math.max(...list.map((e) => indexOf.get(e) ?? 0)),
      journey: {
        ad: list.find((e) => e.ad_content)?.ad_content ?? null,
        steps: labels.length > MAX_STEPS ? [...labels.slice(0, MAX_STEPS), '…'] : labels,
        days: days.size,
      },
    });
  }

  const next: NextPage[] = [...transitions.entries()]
    .map(([page, row]) => ({
      page,
      people: [...row.values()].reduce((a, b) => a + b, 0),
      to: top(row, 3).map(({ key, count }) => ({ label: key, count })),
    }))
    .sort((a, b) => b.people - a.people || a.page.localeCompare(b.page))
    .slice(0, 6);

  return {
    people: byPerson.size,
    returning,
    funnel,
    next,
    lastStops: top(lastStops, 6).map(({ key, count }) => ({ label: key, count })),
    journeys: journeys
      .sort((a, b) => b.lastIndex - a.lastIndex)
      .slice(0, JOURNEYS_SHOWN)
      .map((j) => j.journey),
  };
}
