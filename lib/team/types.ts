import type { Ymd } from '@/lib/rounds/dates';

/** ISO weekdays: 1 = Monday … 7 = Sunday. */
export type IsoDay = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type TeamPerson = {
  id: string;
  kind: 'lead' | 'helper';
  name: string;
  dayRatePence: number;
  usualDays: number[];
  /** Leads only: their workers.id. */
  workerId: string | null;
  /** Leads only. */
  inviteStatus: 'pending' | 'accepted' | 'deactivated' | null;
  email: string | null;
  phone: string | null;
  endedAt: string | null;
};

export type DayOff = { id: string; workerId: string; from: Ymd; to: Ymd; note: string | null };

export type TeamResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export const DEFAULT_USUAL_DAYS = [1, 2, 3, 4, 5] as const;

export function penceFromPounds(pounds: number): number {
  return Math.round(pounds * 100);
}
