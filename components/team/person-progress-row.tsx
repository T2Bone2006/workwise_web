import Link from 'next/link';
import { Avatar, Tag } from '@/components/look';
import { toneClasses } from '@/components/look/tones';
import type { TeamTodayPerson } from '@/lib/data/rounds/team-today-core';
import { formatGbp } from '@/lib/money/pence';
import { cn } from '@/lib/utils';

/** One person on the Dashboard card: how far through they are, what they've taken and what they hold for you. */
export function PersonProgressRow({ person }: { person: TeamTodayPerson }) {
  const pct = person.stops > 0 ? Math.round((person.done / person.stops) * 100) : 0;
  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
        <Avatar name={person.name} tone={person.isOwner ? 'slate' : 'rounds'} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-sm font-medium">{person.name}</span>
            {person.left ? <Tag tone="slate">Left the team</Tag> : null}
            {person.showNotStarted ? <Tag tone="slate">Not started</Tag> : null}
            {person.stopsOnDayOff ? (
              <Link href="/calendar?view=day" className="rounded-full focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none" aria-label={`${person.name} has stops on a day off. Open today's plan to fix it`}>
                <Tag tone="rose">Stops on a day off</Tag>
              </Link>
            ) : null}
          </div>
          {person.helpersToday.length > 0 ? (
            <p className="text-xs text-muted-foreground">with {person.helpersToday.join(' and ')}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {!person.isOwner && person.takenToday > 0 ? (
            <span className={cn('text-xs font-medium tabular-nums', toneClasses('emerald').text)}>Taken {formatGbp(person.takenToday)}</span>
          ) : null}
          {person.holding > 0 ? (
            <Link href="/team/cash" className="rounded-full focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
              <Tag tone="rose">Holding {formatGbp(person.holding)}</Tag>
            </Link>
          ) : null}
        </div>
      </div>
      {person.stops > 0 ? (
        <div className="flex items-center gap-3 pl-10">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={person.stops}
            aria-valuenow={person.done}
            aria-label={`${person.name}: ${person.done} of ${person.stops} done`}
          >
            <div className={cn('h-full rounded-full', toneClasses('sky').solid)} style={{ width: `${pct}%` }} />
          </div>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {person.done} of {person.stops} done{person.skipped > 0 ? ` · ${person.skipped} skipped` : ''}
          </span>
        </div>
      ) : null}
    </li>
  );
}
