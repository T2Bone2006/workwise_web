import type { Tone } from '@/components/look/tones';

/**
 * Lanes for the Day view (D12): one column per person who can do visits. Pure.
 * The owner's lane comes first (You), then each lead A to Z. A visit with no assignee, or one we don't know, is the owner's.
 */

export type LanePerson = { workerId: string; name: string; isOwner: boolean };

export type Lane<T> = {
  workerId: string;
  name: string;
  isOwner: boolean;
  colour: Tone;
  stops: T[];
  /** Off today (days off cover the date). */
  off: boolean;
};

/** Person colours: tones that don't already mean something on its own (not money, not "today", not needs-you). */
const PALETTE: Tone[] = ['indigo', 'teal', 'violet', 'lite', 'rounds'];

/** A stable colour for each person: the owner is slate, leads take the palette in A to Z order. Never changes with filters. */
export function personColours(people: ReadonlyArray<LanePerson>): Map<string, Tone> {
  const map = new Map<string, Tone>();
  const leads = people.filter((p) => !p.isOwner).sort((a, b) => a.name.localeCompare(b.name) || a.workerId.localeCompare(b.workerId));
  leads.forEach((p, i) => map.set(p.workerId, PALETTE[i % PALETTE.length]!));
  for (const p of people) if (p.isOwner) map.set(p.workerId, 'slate');
  return map;
}

function ordered(people: ReadonlyArray<LanePerson>): LanePerson[] {
  const owner = people.filter((p) => p.isOwner);
  const leads = people.filter((p) => !p.isOwner).sort((a, b) => a.name.localeCompare(b.name) || a.workerId.localeCompare(b.workerId));
  return [...owner, ...leads];
}

export function groupIntoLanes<T extends { assigned_worker_id: string | null }>(
  stops: T[],
  people: ReadonlyArray<LanePerson>,
  offToday: ReadonlySet<string>,
): Array<Lane<T>> {
  const list = ordered(people);
  const owner: LanePerson = list.find((p) => p.isOwner) ?? { workerId: '__owner__', name: 'You', isOwner: true };
  const everyone = list.some((p) => p.isOwner) ? list : [owner, ...list];
  const colours = personColours(everyone);
  const known = new Set(everyone.map((p) => p.workerId));

  const lanes = new Map<string, Lane<T>>(
    everyone.map((p) => [
      p.workerId,
      { workerId: p.workerId, name: p.name, isOwner: p.isOwner, colour: colours.get(p.workerId) ?? 'slate', stops: [], off: offToday.has(p.workerId) },
    ]),
  );
  for (const stop of stops) {
    const id = stop.assigned_worker_id && known.has(stop.assigned_worker_id) ? stop.assigned_worker_id : owner.workerId;
    lanes.get(id)!.stops.push(stop);
  }
  return [...lanes.values()];
}

/**
 * The stops one person (or everyone) is looking at. 'mine' is the owner's own stops; a worker id is that person's. A visit with
 * no assignee, or an unknown one, counts as the owner's, the same fallback the lanes use.
 */
export function filterByPerson<T extends { assigned_worker_id: string | null }>(
  stops: T[],
  personId: string | 'all' | 'mine',
  people: ReadonlyArray<LanePerson> = [],
): T[] {
  if (personId === 'all') return stops;
  const owner = people.find((p) => p.isOwner)?.workerId ?? null;
  const known = new Set(people.map((p) => p.workerId));
  const wantOwner = personId === 'mine' || (owner !== null && personId === owner);
  return stops.filter((s) => {
    const assignee = s.assigned_worker_id && known.has(s.assigned_worker_id) ? s.assigned_worker_id : null;
    if (wantOwner) return assignee === null || assignee === owner;
    return assignee === personId;
  });
}

/** The ?person= value from the URL: 'all', 'mine', or a person who can do visits. Anything else is 'all'. */
export function parsePersonParam(raw: string | string[] | undefined, people: ReadonlyArray<LanePerson>): string | 'all' | 'mine' {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === 'mine') return 'mine';
  if (value && people.some((p) => p.workerId === value && !p.isOwner)) return value;
  return 'all';
}

/** The worker a filter points at, for scoping Move remaining and the rest: null for Everyone. */
export function personScope(personId: string | 'all' | 'mine', people: ReadonlyArray<LanePerson>): string | null {
  if (personId === 'all') return null;
  if (personId === 'mine') return people.find((p) => p.isOwner)?.workerId ?? null;
  return personId;
}
