/**
 * Round groups for the calendar: houses of the same round that sit next to each other on a day are shown together
 * under the round's name, so the whole round can be moved or given away in one go. Pure.
 *
 * Only runs that are already next to each other in route order are grouped: this never changes the order of a day.
 */

/** The round a visit belongs to (through its agreement). */
export type RoundTag = { id: string; name: string; colour: string; /** Who usually does it (workers.id); null = the owner. */ leadWorkerId?: string | null };

/** Fewest houses in a row before they are drawn as a group. One house alone is just a house. */
export const MIN_GROUP_SIZE = 2;

export type StopSegment<T> = {
  /** Null for houses with no round, or a round with a single house on the day. */
  round: RoundTag | null;
  stops: T[];
};

/** Read the round off the visits that make up a stop. */
export function roundOfVisits(
  visits: ReadonlyArray<{ round_id: string | null; round_name: string | null; round_colour: string | null; round_lead_worker_id?: string | null }>,
): RoundTag | null {
  for (const v of visits) {
    if (v.round_id && v.round_name) {
      return { id: v.round_id, name: v.round_name, colour: v.round_colour ?? '#475569', leadWorkerId: v.round_lead_worker_id ?? null };
    }
  }
  return null;
}

/**
 * Split a day's stops (in route order) into segments. A run of two or more stops from the same round becomes one
 * segment with that round; everything else is gathered into plain segments, in the same order.
 */
export function segmentByRound<T extends { round: RoundTag | null }>(stops: ReadonlyArray<T>): Array<StopSegment<T>> {
  const segments: Array<StopSegment<T>> = [];
  let i = 0;
  while (i < stops.length) {
    const round = stops[i]!.round;
    let j = i + 1;
    if (round) while (j < stops.length && stops[j]!.round?.id === round.id) j += 1;
    if (round && j - i >= MIN_GROUP_SIZE) {
      segments.push({ round, stops: stops.slice(i, j) as T[] });
      i = j;
      continue;
    }
    // Not a group: keep it with the plain stops around it.
    const last = segments[segments.length - 1];
    const plain = stops.slice(i, round ? j : i + 1) as T[];
    if (last && last.round === null) last.stops.push(...plain);
    else segments.push({ round: null, stops: plain });
    i = round ? j : i + 1;
  }
  return segments;
}

/** Sort key that keeps a round's houses next to each other when nothing else decides their order. */
export function roundSortKey(visit: { round_id: string | null }): string {
  return visit.round_id ?? '￿';
}
