'use client';

import Link from 'next/link';
import { Banknote, CalendarOff, MoreHorizontal, Pencil, Route, Send, Trash2, Wallet } from 'lucide-react';
import { Avatar, Tag } from '@/components/look';
import { rowHover } from '@/components/look/row-hover';
import { toneClasses } from '@/components/look/tones';
import { RoundChip } from '@/components/rounds/round-chip';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { TeamPagePerson } from '@/lib/data/team-page-core';
import { formatGbp } from '@/lib/money/pence';
import { DAY_LETTERS, DAY_SHORT, usualDaysLabel } from '@/lib/team/usual-days';
import { cn } from '@/lib/utils';
import { formatRange } from './format-range';

export type PersonRowActions = {
  onEdit: (person: TeamPagePerson) => void;
  onDaysOff: (person: TeamPagePerson) => void;
  onRounds: (person: TeamPagePerson) => void;
  onRemove: (person: TeamPagePerson) => void;
  onResend: (person: TeamPagePerson) => void;
};

const COLUMNS = 'md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.3fr)_12.25rem_6rem_2rem]';

function TodayStatus({ person }: { person: TeamPagePerson }) {
  const isHelper = person.kind === 'helper';
  if (person.kind === 'lead' && person.inviteStatus === 'pending') {
    return <span className="text-sm text-muted-foreground">Hasn&apos;t logged in yet</span>;
  }
  if (person.today === 'off') return <Tag tone="amber">Off today</Tag>;
  if (person.today === 'working') {
    const stops = !isHelper && person.stopsToday > 0;
    return (
      <span className="flex min-w-0 items-center gap-2">
        <Tag tone="emerald">Working</Tag>
        <span className="truncate text-xs text-muted-foreground tabular-nums">
          {stops ? `${person.doneToday} of ${person.stopsToday} stops done` : 'Out today'}
        </span>
      </span>
    );
  }
  if (person.today === 'not_started') {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <Tag tone="slate">Not started</Tag>
        <span className="truncate text-xs text-muted-foreground tabular-nums">
          {person.stopsToday} {person.stopsToday === 1 ? 'stop' : 'stops'} today
        </span>
      </span>
    );
  }
  return <Tag tone="slate">{isHelper ? 'Not out today' : 'No stops today'}</Tag>;
}

function StopProgress({ person }: { person: TeamPagePerson }) {
  if (person.kind === 'helper' || person.today !== 'working' || person.stopsToday <= 0) return null;
  return (
    <div
      className="h-1.5 w-full max-w-48 overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={person.stopsToday}
      aria-valuenow={person.doneToday}
      aria-label={`${person.doneToday} of ${person.stopsToday} stops done`}
    >
      <div className={cn('h-full rounded-full', toneClasses('emerald').solid)} style={{ width: `${(person.doneToday / person.stopsToday) * 100}%` }} />
    </div>
  );
}

function UsualDays({ days }: { days: number[] }) {
  return (
    <div className="flex shrink-0 gap-1" role="img" aria-label={`Usually works ${usualDaysLabel(days)}`} title={usualDaysLabel(days)}>
      {DAY_LETTERS.map((letter, index) => (
        <span
          key={DAY_SHORT[index]}
          aria-hidden="true"
          className={cn(
            'flex size-6 items-center justify-center rounded-full text-[11px] font-medium',
            days.includes(index + 1) ? 'bg-(--tone-rounds-solid) text-white' : 'bg-muted text-muted-foreground',
          )}
        >
          {letter}
        </span>
      ))}
    </div>
  );
}

function RowMenu({ person, actions }: { person: TeamPagePerson; actions: PersonRowActions }) {
  const ended = Boolean(person.endedAt);
  const pending = person.kind === 'lead' && person.inviteStatus === 'pending';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${person.name}`}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {ended ? null : (
          <DropdownMenuItem onSelect={() => actions.onEdit(person)}>
            <Pencil /> Edit
          </DropdownMenuItem>
        )}
        {person.kind === 'lead' && !ended && person.workerId && !pending ? (
          <DropdownMenuItem onSelect={() => actions.onRounds(person)}>
            <Route /> Rounds
          </DropdownMenuItem>
        ) : null}
        {person.kind === 'lead' && !ended && person.workerId ? (
          <DropdownMenuItem onSelect={() => actions.onDaysOff(person)}>
            <CalendarOff /> Days off
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem asChild>
          <Link href={`/team/pay?person=${person.id}`}>
            <Wallet /> Pay &amp; days
          </Link>
        </DropdownMenuItem>
        {pending ? (
          <DropdownMenuItem onSelect={() => actions.onResend(person)}>
            <Send /> Resend invite
          </DropdownMenuItem>
        ) : null}
        {ended ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => actions.onRemove(person)}>
              <Trash2 /> Remove
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RoundChips({ person, onAssign }: { person: TeamPagePerson; onAssign?: () => void }) {
  if (person.usualRounds.length === 0) {
    return onAssign ? (
      <button
        type="button"
        onClick={onAssign}
        className="relative z-10 inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <Route className="size-3" aria-hidden /> Give them a round
      </button>
    ) : null;
  }
  return (
    <div className="flex min-w-0 flex-wrap gap-1" aria-label="Usual rounds">
      {person.usualRounds.slice(0, 2).map((round) => (
        <RoundChip key={round.id} round={round} className="max-w-[10rem] py-0.5" />
      ))}
      {person.usualRounds.length > 2 ? (
        <span className="text-xs text-muted-foreground">+{person.usualRounds.length - 2}</span>
      ) : null}
    </div>
  );
}

/** One person on the team: who they are, whether they're out today, their usual days and what they cost. */
function PersonRow({ person, actions }: { person: TeamPagePerson; actions: PersonRowActions }) {
  const ended = Boolean(person.endedAt);
  const pending = person.kind === 'lead' && person.inviteStatus === 'pending';
  const isLead = person.kind === 'lead';
  const nextOff = person.daysOff[0];
  const contact = pending ? person.email : isLead ? [person.phone, person.email].filter(Boolean).join(' · ') : null;
  const showHeld = person.heldCashPence > 0;
  const showNextOff = Boolean(nextOff && !ended && person.today !== 'off');
  const showStops = !ended && person.kind === 'lead' && person.today === 'working' && person.stopsToday > 0;
  const canAssign = isLead && !ended && !pending && Boolean(person.workerId);
  const showRounds = person.usualRounds.length > 0 || canAssign;
  const showDetail = showStops || showHeld || showNextOff || showRounds;
  const nameClass =
    'block min-w-0 truncate text-left font-medium text-foreground after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset';

  return (
    <li className={cn('relative px-4 py-3', rowHover, ended && 'opacity-70')}>
      <div className={cn('grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2', COLUMNS)}>
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={person.name} tone={isLead && !ended ? 'rounds' : 'slate'} />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              {ended ? (
                <Link href={`/team/pay?person=${person.id}`} className={nameClass}>
                  {person.name}
                </Link>
              ) : (
                <button type="button" onClick={() => actions.onEdit(person)} className={nameClass}>
                  {person.name}
                </button>
              )}
              {pending ? (
                <Tag tone="amber">Invite sent</Tag>
              ) : (
                <Tag tone={isLead ? 'rounds' : 'slate'}>{isLead ? 'Lead' : 'Helper'}</Tag>
              )}
            </div>
            <p className="truncate text-xs text-muted-foreground">{contact || (isLead ? 'No phone or email' : 'No login, paid by the day')}</p>
          </div>
        </div>

        <div className="relative z-10 flex items-center justify-end md:order-last">
          <RowMenu person={person} actions={actions} />
        </div>

        <div className="col-span-2 flex min-w-0 items-center md:col-span-1">
          {ended ? <Tag tone="slate">Removed</Tag> : <TodayStatus person={person} />}
        </div>

        <div className="flex items-center">
          <UsualDays days={person.usualDays} />
        </div>

        <div className="text-right">
          <p className="font-semibold tabular-nums leading-tight">{formatGbp(person.dayRatePence / 100)}</p>
          <p className="text-xs text-muted-foreground">a day</p>
        </div>
      </div>

      {showDetail ? (
        <div className={cn('mt-1.5 grid grid-cols-1 gap-x-4 gap-y-1.5', COLUMNS)}>
          {showStops || showHeld || showNextOff ? (
            <div className="flex min-w-0 flex-col items-start gap-1.5 md:col-start-2">
              {showStops ? <StopProgress person={person} /> : null}
              {showHeld || showNextOff ? (
                <div className="flex flex-wrap gap-1.5">
                  {showHeld ? (
                    <Tag tone="rose">
                      <Banknote className="size-3" aria-hidden="true" />
                      {ended ? 'Owes' : 'Holding'} {formatGbp(person.heldCashPence / 100)}
                    </Tag>
                  ) : null}
                  {showNextOff && nextOff ? (
                    <Tag tone="amber">
                      <CalendarOff className="size-3" aria-hidden="true" />
                      Off {formatRange(nextOff.from, nextOff.to)}
                    </Tag>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {showRounds ? (
            <div className="min-w-0 md:col-start-3">
              <RoundChips person={person} onAssign={canAssign ? () => actions.onRounds(person) : undefined} />
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** The team as one list card with a column header on wider screens, like the customers list. */
export function PersonList({ people, actions }: { people: TeamPagePerson[]; actions: PersonRowActions }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-(--look-card-shadow)">
      <div className={cn('hidden gap-4 border-b border-border bg-muted/50 px-4 py-2.5 text-xs font-medium text-muted-foreground md:grid', COLUMNS)}>
        <span>Person</span>
        <span>Today</span>
        <span>Usual days</span>
        <span className="text-right">Day rate</span>
        <span className="sr-only">Actions</span>
      </div>
      <ul className="divide-y divide-border">
        {people.map((person) => (
          <PersonRow key={person.id} person={person} actions={actions} />
        ))}
      </ul>
    </div>
  );
}
