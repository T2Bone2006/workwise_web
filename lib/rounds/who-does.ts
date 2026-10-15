/**
 * Who is doing the work, for the calendar. Pure.
 *
 * A visit with no person is the owner's. A round header names the person doing most of its houses that day ("Dave", or
 * "Dave + 1" when it is split); a house card only gets a tag when its person is not the one you'd expect (the group's
 * person, else the round's usual person, else the owner), so a calendar where everything is as usual stays quiet.
 */

type Visited = { visits: ReadonlyArray<{ assigned_worker_id: string | null }> };

/** Who has this stop (a house, one or more visits). */
export function personOfStop(stop: Visited, ownerId: string | null): string | null {
  return stop.visits[0]?.assigned_worker_id ?? ownerId;
}

export type WhoDoes = { workerId: string | null; others: number };

/** The person with most of these stops (ties: the first seen), and how many other people have the rest. */
export function whoDoes(stops: ReadonlyArray<Visited>, ownerId: string | null): WhoDoes {
  const counts = new Map<string | null, number>();
  for (const stop of stops) {
    const p = personOfStop(stop, ownerId);
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [p, n] of counts) {
    if (n > bestCount) {
      best = p;
      bestCount = n;
    }
  }
  return { workerId: best, others: counts.size === 0 ? 0 : counts.size - 1 };
}

/** Show a tag on a card only when its person differs from the one expected there. */
export function needsPersonTag(personId: string | null, expectedId: string | null): boolean {
  return personId !== expectedId;
}

/** Who is expected on a house outside a group: its round's usual person, else the owner. */
export function expectedForStop(round: { leadWorkerId?: string | null } | null, ownerId: string | null): string | null {
  return round?.leadWorkerId ?? ownerId;
}

export type DayPerson = { workerId: string | null; stops: number };

/** Each person who has stops on a day, with how many, the owner first and then by most stops. */
export function dayPeople(stops: ReadonlyArray<Visited & { state?: string }>, ownerId: string | null): DayPerson[] {
  const counts = new Map<string | null, number>();
  for (const stop of stops) {
    if (stop.state === 'skipped') continue;
    const p = personOfStop(stop, ownerId);
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([workerId, n]) => ({ workerId, stops: n }))
    .sort((a, b) => Number(b.workerId === ownerId) - Number(a.workerId === ownerId) || b.stops - a.stops);
}
