import type { LatLng, MapPlace } from '@/lib/rounds/map-areas';
import { summarisePlaces } from '@/lib/rounds/map-areas';

/*
 * Named rounds: a way to group a business's places on the map and in lists.
 * Pure helpers only; saving lives in lib/actions/rounds/rounds.ts.
 */

export type RoundRow = { id: string; name: string; colour: string };

/** A round being made or edited on the map. Nothing is saved until Save. */
export type RoundDraft = {
  /** Draw a shape round the pins, or tap pins one by one. */
  mode: 'draw' | 'pick';
  /** The round being edited, or null for a new one. */
  editingId: string | null;
  /** Corners dropped so far while drawing. */
  points: LatLng[];
  /** The finished shape, once closed. */
  shape: LatLng[] | null;
  /** Places that will be in the round. */
  picked: Set<string>;
};

export const MAX_ROUND_NAME = 60;

/**
 * Colours to pick from. None of them is red, green, amber or the map-pin blue,
 * because those already mean owes, quiet-to-busy, due this week and all fine.
 */
export const ROUND_COLOURS = [
  '#7c3aed',
  '#c026d3',
  '#4f46e5',
  '#0891b2',
  '#be185d',
  '#92400e',
  '#0d9488',
  '#475569',
] as const;

const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;

export function isRoundColour(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOUR.test(value);
}

/** The first palette colour no round uses yet; once they are all used, start again. */
export function nextRoundColour(used: string[]): string {
  const taken = new Set(used.map((c) => c.toLowerCase()));
  const free = ROUND_COLOURS.find((c) => !taken.has(c));
  return free ?? ROUND_COLOURS[used.length % ROUND_COLOURS.length]!;
}

export type NameCheck = { ok: true; name: string } | { ok: false; error: string };

export function cleanRoundName(raw: unknown): NameCheck {
  const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (name === '') return { ok: false, error: 'Give the round a name' };
  if (name.length > MAX_ROUND_NAME) return { ok: false, error: `Keep the name under ${MAX_ROUND_NAME + 1} characters` };
  return { ok: true, name };
}

/** True if another round already has this name, ignoring capitals and spacing. */
export function roundNameTaken(name: string, rounds: RoundRow[], exceptId?: string | null): boolean {
  const key = name.replace(/\s+/g, ' ').trim().toLowerCase();
  return rounds.some((r) => r.id !== exceptId && r.name.replace(/\s+/g, ' ').trim().toLowerCase() === key);
}

/** Even-odd test: is the point inside the shape? Points are [lat, lng]. */
export function pointInShape(point: LatLng, shape: LatLng[]): boolean {
  if (shape.length < 3) return false;
  let inside = false;
  for (let i = 0, j = shape.length - 1; i < shape.length; j = i, i += 1) {
    const a = shape[i]!;
    const b = shape[j]!;
    if (a[0] > point[0] !== b[0] > point[0] && point[1] < ((b[1] - a[1]) * (point[0] - a[0])) / (b[0] - a[0]) + a[1]) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * The places inside a drawn shape. A place already in another round is left
 * out (draw never steals); one in `editingId`'s own round or in none is taken.
 */
export function placesInShape(places: MapPlace[], shape: LatLng[], editingId: string | null): MapPlace[] {
  return places.filter(
    (p) => (p.roundId === null || p.roundId === editingId) && pointInShape([p.lat, p.lng], shape),
  );
}

export type RoundSummary = RoundRow & {
  places: number;
  customers: number;
  yearly: number;
};

/** Each round with how many places, customers and yearly money are in it. */
export function summariseRounds(rounds: RoundRow[], places: MapPlace[]): RoundSummary[] {
  return rounds.map((round) => {
    const members = places.filter((p) => p.roundId === round.id);
    const stats = summarisePlaces(members);
    return { ...round, places: members.length, customers: stats.customers, yearly: stats.yearly };
  });
}

/** Places picked for a round that currently sit in a different round, so the panel can say they will move. */
export function movingFromOtherRounds(selectedIds: Iterable<string>, places: MapPlace[], targetId: string | null): number {
  const byId = new Map(places.map((p) => [p.id, p]));
  let moving = 0;
  for (const id of selectedIds) {
    const roundId = byId.get(id)?.roundId ?? null;
    if (roundId !== null && roundId !== targetId) moving += 1;
  }
  return moving;
}

/** What a save changes, so the action only writes the difference. */
export function membershipChanges(
  currentMemberIds: string[],
  wantedIds: string[],
): { add: string[]; remove: string[] } {
  const current = new Set(currentMemberIds);
  const wanted = new Set(wantedIds);
  return {
    add: [...wanted].filter((id) => !current.has(id)),
    remove: [...current].filter((id) => !wanted.has(id)),
  };
}
