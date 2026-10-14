'use client';

import { Fragment, type JSX } from 'react';
import { GripVertical, MoreHorizontal } from 'lucide-react';
import { useDraggable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import { formatGbp } from '@/lib/money/pence';
import { formatBoardDay, roundAsStop, type BoardDay, type BoardStop } from '@/lib/rounds/week-board';
import type { LanePerson } from '@/lib/rounds/lanes';
import { segmentByRound, type RoundTag } from '@/lib/rounds/round-groups';
import { RoundGroup, RoundGroupMenu, RoundPersonMenu } from '@/components/rounds/round-group';
import { dayPeople, expectedForStop, whoDoes } from '@/lib/rounds/who-does';
import { personColours } from '@/lib/rounds/lanes';
import type { Tone } from '@/components/look/tones';
import { PersonChipButton } from '@/components/team/assignee-chip';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DayWeather } from '@/components/weather/day-weather';
import type { DayWeather as DayWeatherData } from '@/lib/weather/met-norway';
import { BoardStopCard } from './board-stop-card';

export type ColumnHighlight = 'drop' | 'swap' | 'denied' | 'swap-source' | null;

/** The handle on a round group: pick the whole round up and put it on another day. */
function RoundGrip({ date, round, disabled }: { date: string; round: RoundTag; disabled: boolean }): JSX.Element | null {
  return disabled ? null : <ActiveRoundGrip date={date} round={round} />;
}

function ActiveRoundGrip({ date, round }: { date: string; round: RoundTag }): JSX.Element {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: `roundhead:${date}:${round.id}`, data: { date, roundId: round.id } });
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      type="button"
      aria-label={`Drag all of ${round.name} onto another day`}
      className="-ml-0.5 shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-muted"
    >
      <GripVertical className="size-3.5" />
    </button>
  );
}

/** One day: header with its totals, grip and ⋯ menu, then its stops top to bottom. */
export function BoardDayColumn(props: {
  day: BoardDay;
  flashIds: ReadonlySet<string>;
  /** The stop of this day that is in the air, if any. */
  liftedStopId: string | null;
  /** One job of a stop here that is in the air (the stop stays), if any. */
  liftedJobId: string | null;
  /** The round group of this day that is in the air, if any. */
  liftedRoundId: string | null;
  /** Where a dashed gap is open in this column (index among its other stops), or null. */
  gapIndex: number | null;
  /** Show a dashed outline where the lifted stop came from (it isn't over a valid place). */
  originIndex: number | null;
  /** Height of the gap, taken from the card being dragged. */
  gapHeight: number;
  /** The stop here that a dragged card would join (same house), if any. */
  joinStopId: string | null;
  highlight: ColumnHighlight;
  /** The forecast for this day, when there is one (today and the next 8 days). */
  weather?: DayWeatherData;
  /** Dragging is off while a move is saving. */
  locked: boolean;
  onOpen: (stop: BoardStop, date: string) => void;
  onMove: (stop: BoardStop, date: string) => void;
  onMoveJob: (stop: BoardStop, date: string, jobId: string) => void;
  onTell: (changeId: string) => void;
  onSwap: (day: BoardDay) => void;
  /** Move a whole round group to another day (the dialog). */
  onMoveRound: (stops: BoardStop[], round: RoundTag, date: string) => void;
  /** With a team: who a whole round can be given to, and who is off today. */
  people?: ReadonlyArray<LanePerson>;
  off?: ReadonlySet<string>;
  onGiveRound: (stops: BoardStop[], round: RoundTag, person: LanePerson, date: string) => void;
  /** Give one house to someone (its ⋯ menu). */
  onGiveStop: (stop: BoardStop, person: LanePerson, date: string) => void;
  /** Make someone a round's usual person (every time). */
  onUsualRound: (round: RoundTag, person: LanePerson) => void;
  /** Give everything one person has on this day to someone else. */
  onGiveDay: (date: string, fromWorkerId: string, to: LanePerson) => void;
}): JSX.Element {
  const { day } = props;
  const gripOk = !day.isPast && day.stops.some((s) => s.movable) && !props.locked;
  const grip = useDraggable({ id: `dayhead:${day.date}`, disabled: !gripOk });
  // A working day still to come with nothing booked: room for more work.
  const spare = !day.isDayOff && !day.isPast && day.stops.length === 0;
  // Placeholders (the dashed gap where a card would land, or where it came from) sit between the
  // other stops, so positions are counted without the stop that is in the air.
  let othersSeen = 0;
  const gapAt = (position: number) => {
    const isGap = props.gapIndex === position;
    const isOrigin = !isGap && props.originIndex === position;
    if (!isGap && !isOrigin) return null;
    return (
      <div
        key={`${isGap ? 'gap' : 'origin'}-${position}`}
        data-board-placeholder={isGap ? 'gap' : 'origin'}
        style={{ height: props.gapHeight }}
        className="rounded-xl border-2 border-dashed border-primary/40 bg-primary/5"
      />
    );
  };

  const ownerId = props.people?.find((p) => p.isOwner)?.workerId ?? null;
  const nameOf = (id: string | null) => {
    const p = props.people?.find((x) => x.workerId === id);
    return p ? (p.isOwner ? 'You' : (p.name.trim().split(/\s+/)[0] ?? p.name)) : 'You';
  };
  const colours = props.people ? personColours(props.people) : new Map<string, Tone>();
  const toneOf = (id: string | null): Tone => (id ? colours.get(id) : undefined) ?? 'slate';
  const working = props.people ? dayPeople(day.stops, ownerId) : [];

  const summary = [
    `${day.total} ${day.total === 1 ? 'stop' : 'stops'}`,
    formatGbp(day.plannedAmount),
    day.total > 0 ? `${day.done}/${day.total} done` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <section
      data-date={day.date}
      aria-label={formatBoardDay(day.date)}
      className={cn(
        'flex h-[calc(100vh-14rem)] min-h-80 shrink-0 flex-col rounded-2xl border border-border bg-card shadow-(--look-card-shadow)',
        'w-[200px] @min-[960px]/board:w-auto @min-[960px]/board:min-w-0 @min-[960px]/board:flex-1 @min-[960px]/board:shrink',
        day.isDayOff && 'border-dashed bg-muted/50 shadow-none',
        spare && 'border-(--tone-emerald-line) bg-(--tone-emerald-soft)',
        day.isToday && 'ring-2 ring-(--tone-sky-solid)',
        props.highlight === 'drop' && 'bg-primary/5 ring-1 ring-primary/30',
        props.highlight === 'swap' && 'ring-2 ring-primary/50',
        props.highlight === 'swap-source' && 'border-dashed border-primary/50',
        props.highlight === 'denied' && 'cursor-not-allowed',
      )}
    >
      <header className="flex items-start justify-between gap-1 border-b border-border px-2.5 py-2">
        {gripOk ? (
          <button
            ref={grip.setNodeRef}
            {...grip.attributes}
            {...grip.listeners}
            type="button"
            aria-label={`Drag ${formatBoardDay(day.date)} onto another day to swap them`}
            className="-ml-1 mt-0.5 shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-muted"
          >
            <GripVertical className="size-4" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'flex flex-wrap items-center gap-1.5 text-sm font-semibold',
              (day.isPast || day.isDayOff) && 'text-muted-foreground',
            )}
          >
            {formatBoardDay(day.date)}
            {day.isToday ? (
              <span className="rounded-full bg-(--tone-sky-solid) px-1.5 text-[10px] font-bold leading-4 text-white">
                Today
              </span>
            ) : null}
            {day.isDayOff ? (
              <span className="rounded-full bg-(--tone-slate-soft) px-1.5 text-[10px] font-semibold leading-4 text-(--tone-slate-text)">
                Day off
              </span>
            ) : spare ? (
              <span className="rounded-full bg-card/70 px-1.5 text-[10px] font-semibold leading-4 text-(--tone-emerald-text)">
                Spare
              </span>
            ) : null}
          </p>
          <p className="truncate text-xs text-muted-foreground">{summary}</p>
          {working.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1" role="group" aria-label="Who is working">
              {working.map((w) => {
                const others = (props.people ?? []).filter((p) => p.workerId !== w.workerId);
                const canGive = !day.isPast && !props.locked && w.workerId !== null && others.length > 0;
                const chip = (
                  <PersonChipButton
                    name={nameOf(w.workerId)}
                    colour={toneOf(w.workerId)}
                    count={w.stops}
                    size="sm"
                    chevron={false}
                    disabled={!canGive}
                    aria-label={`${nameOf(w.workerId)} has ${w.stops} ${w.stops === 1 ? 'stop' : 'stops'}${canGive ? '. Give their day to someone else' : ''}`}
                  />
                );
                if (!canGive) return <span key={w.workerId ?? 'none'}>{chip}</span>;
                return (
                  <DropdownMenu key={w.workerId ?? 'none'}>
                    <DropdownMenuTrigger asChild>{chip}</DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuLabel>Give {nameOf(w.workerId) === 'You' ? 'your' : `${nameOf(w.workerId)}'s`} day to</DropdownMenuLabel>
                      {others.map((p) => (
                        <DropdownMenuItem key={p.workerId} onSelect={() => props.onGiveDay(day.date, w.workerId as string, p)}>
                          {p.isOwner ? 'You' : p.name}
                          {props.off?.has(p.workerId) ? <span className="ml-auto text-xs text-(--tone-amber-text)">Off</span> : null}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              })}
            </div>
          ) : null}
          {/* Always one line tall, so columns line up when a day has no forecast. */}
          <div className="mt-0.5 flex h-4 items-center overflow-hidden">
            {props.weather ? <DayWeather weather={props.weather} className="whitespace-nowrap" /> : null}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              aria-label={`Options for ${formatBoardDay(day.date)}`}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={day.isPast} onSelect={() => props.onSwap(day)}>
              Swap with…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <div data-col-scroll className="flex-1 space-y-2 overflow-y-auto p-2">
        {day.stops.length === 0 && props.gapIndex === null ? (
          <div className="flex h-20 items-center justify-center rounded-xl border border-dashed border-border bg-card/60 text-xs text-muted-foreground">
            {spare ? 'Free: room for more work' : 'No jobs'}
          </div>
        ) : null}
        {gapAt(0)}
        {segmentByRound(day.stops).map((segment, segIndex) => {
          const round = segment.round;
          const who = whoDoes(segment.stops, ownerId);
          // In a group, a card is only tagged when it isn't with the person doing most of the round; outside one, when it
          // isn't with its round's usual person (or the owner).
          const expectedFor = (stop: BoardStop): string | null | undefined =>
            !props.people ? undefined : round ? who.workerId : expectedForStop(stop.round, ownerId);
          const cards = segment.stops.map((stop) => (
            <Fragment key={stop.id}>
              <BoardStopCard
                stop={stop}
                date={day.date}
                flash={stop.jobIds.some((id) => props.flashIds.has(id))}
                lifted={stop.id === props.liftedStopId}
                liftedJobId={stop.jobIds.includes(props.liftedJobId ?? '') ? props.liftedJobId : null}
                join={stop.id === props.joinStopId}
                locked={props.locked}
                onOpen={(s) => props.onOpen(s, day.date)}
                onMove={(s) => props.onMove(s, day.date)}
                onMoveJob={(s, jobId) => props.onMoveJob(s, day.date, jobId)}
                onTell={props.onTell}
                people={props.people}
                off={props.off}
                expectedId={expectedFor(stop)}
                onGive={props.people ? (s, person) => props.onGiveStop(s, person, day.date) : undefined}
              />
              {stop.id === props.liftedStopId ? null : gapAt(++othersSeen)}
            </Fragment>
          ));
          if (!round) return <Fragment key={`plain-${segIndex}`}>{cards}</Fragment>;
          const whole = roundAsStop(segment.stops, round);
          const canMove = Boolean(whole) && !day.isPast && !props.locked;
          return (
            <RoundGroup
              key={`round-${round.id}-${segIndex}`}
              round={round}
              houses={segment.stops.filter((s) => s.state !== 'skipped').length}
              amount={segment.stops.reduce((sum, s) => sum + s.amount, 0)}
              lifted={props.liftedRoundId === round.id}
              grip={<RoundGrip date={day.date} round={round} disabled={!canMove} />}
              who={
                props.people ? (
                  <RoundPersonMenu
                    name={nameOf(who.workerId)}
                    colour={toneOf(who.workerId)}
                    extra={who.others}
                    people={props.people}
                    currentWorkerId={who.workerId}
                    usualWorkerId={round.leadWorkerId ?? ownerId}
                    off={props.off}
                    disabled={!canMove}
                    onThisDay={(person) => props.onGiveRound(segment.stops, round, person, day.date)}
                    onEveryTime={(person) => props.onUsualRound(round, person)}
                  />
                ) : undefined
              }
              actions={
                <RoundGroupMenu
                  roundName={round.name}
                  canMove={canMove}
                  onMove={() => props.onMoveRound(segment.stops, round, day.date)}
                />
              }
            >
              {cards}
            </RoundGroup>
          );
        })}
      </div>
    </section>
  );
}
