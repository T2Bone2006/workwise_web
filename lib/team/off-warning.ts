import type { Ymd } from '@/lib/rounds/dates';
import type { StopsOnDayOff } from '@/lib/team/days-off';

/**
 * The "someone is off but still has stops" banner (D11): one warning per person, in plain words. Pure.
 */
export type OffWarning = {
  workerId: string;
  name: string;
  isOwner: boolean;
  /** First and last affected day. */
  from: Ymd;
  to: Ymd;
  /** Each affected day with how many open visits are left on it. */
  days: Array<{ date: Ymd; visitCount: number }>;
  totalStops: number;
  text: string;
};

const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const dayNoMonth = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
const monthOnly = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });

function at(ymd: Ymd): Date {
  return new Date(`${ymd}T12:00:00Z`);
}

/** 'Mon 12 Oct' (one day), 'Mon 12 – Tue 13 Oct' (same month), 'Fri 30 Oct – Mon 2 Nov' (across months). */
export function formatOffRange(from: Ymd, to: Ymd): string {
  if (from === to) return day.format(at(from)).replace(',', '');
  const sameMonth = monthOnly.format(at(from)) === monthOnly.format(at(to));
  if (sameMonth) return `${dayNoMonth.format(at(from)).replace(',', '')} – ${day.format(at(to)).replace(',', '')}`;
  return `${day.format(at(from)).replace(',', '')} – ${day.format(at(to)).replace(',', '')}`;
}

export function groupOffWarnings(stops: ReadonlyArray<StopsOnDayOff>, ownerWorkerId: string | null): OffWarning[] {
  const byWorker = new Map<string, StopsOnDayOff[]>();
  for (const s of stops) {
    if (s.visitCount <= 0) continue;
    const list = byWorker.get(s.workerId);
    if (list) list.push(s);
    else byWorker.set(s.workerId, [s]);
  }
  const out: OffWarning[] = [];
  for (const [workerId, list] of byWorker) {
    const days = [...list].sort((a, b) => a.date.localeCompare(b.date)).map((s) => ({ date: s.date, visitCount: s.visitCount }));
    const from = days[0]!.date;
    const to = days[days.length - 1]!.date;
    const totalStops = days.reduce((sum, d) => sum + d.visitCount, 0);
    const isOwner = ownerWorkerId !== null && workerId === ownerWorkerId;
    const name = isOwner ? 'You' : (list[0]!.workerName || 'Someone');
    const verb = isOwner ? 'are' : 'is';
    const have = isOwner ? 'have' : 'has';
    const when = from === to ? 'that day' : 'on those days';
    out.push({
      workerId,
      name,
      isOwner,
      from,
      to,
      days,
      totalStops,
      text: `${name} ${verb} off ${formatOffRange(from, to)} but ${have} ${totalStops} ${totalStops === 1 ? 'stop' : 'stops'} ${when}.`,
    });
  }
  return out.sort((a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name));
}
