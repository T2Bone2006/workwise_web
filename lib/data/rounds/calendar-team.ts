import 'server-only';

import type { LanePerson } from '@/lib/rounds/lanes';
import { createAdminClient } from '@/lib/supabase/admin';
import { validAssignees } from '@/lib/team/assign';
import { findStopsOnDaysOff } from '@/lib/team/days-off';
import { groupOffWarnings, type OffWarning } from '@/lib/team/off-warning';
import { listDaysOff } from '@/lib/team/team-read';
import type { DayOff } from '@/lib/team/types';
import type { Ymd } from '@/lib/rounds/dates';

export type CalendarTeam = {
  /** The owner and each lead who can take visits. */
  people: LanePerson[];
  /** Workers whose days off cover each date asked for. */
  offOn: (date: Ymd) => Set<string>;
};

/**
 * Who the calendar shows lanes and filters for. Null for a business with no lead (the calendar is then exactly as it was).
 * Never throws: a read problem gives null and the calendar carries on without lanes.
 */
export async function getCalendarTeam(tenantId: string, from: Ymd): Promise<CalendarTeam | null> {
  try {
    const db = createAdminClient();
    const people = await validAssignees(db, tenantId);
    if (!people.some((p) => !p.isOwner)) return null;
    const daysOff = await listDaysOff(db, tenantId, from);
    return {
      people,
      offOn: (date) => new Set(daysOff.filter((d) => d.from <= date && date <= d.to).map((d) => d.workerId)),
    };
  } catch (err) {
    console.error('[calendar-team]', err instanceof Error ? err.message : 'failed');
    return null;
  }
}

export type OffContext = {
  /** The owner and each lead: who can be marked off and who a round can be given to. */
  people: LanePerson[];
  /** Everyone's upcoming days off. */
  daysOff: DayOff[];
  /** One warning per person who is off but still has stops between `from` and `to`. */
  warnings: OffWarning[];
};

/**
 * Days off for the calendar: the banner (someone is off but still has stops) and the "Someone's off" button. Works for a
 * solo trader too (they can go on holiday). Never throws: a read problem gives null and the calendar carries on without it.
 */
export async function getOffContext(tenantId: string, today: Ymd, from: Ymd, to: Ymd): Promise<OffContext | null> {
  try {
    const db = createAdminClient();
    const [people, daysOff, stops] = await Promise.all([
      validAssignees(db, tenantId),
      listDaysOff(db, tenantId, today),
      findStopsOnDaysOff(db, tenantId, from < today ? today : from, to),
    ]);
    const ownerId = people.find((p) => p.isOwner)?.workerId ?? null;
    return { people, daysOff, warnings: groupOffWarnings(stops, ownerId) };
  } catch (err) {
    console.error('[calendar-off]', err instanceof Error ? err.message : 'failed');
    return null;
  }
}
