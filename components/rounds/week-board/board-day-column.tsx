'use client';

import { Fragment, type JSX } from 'react';
import { GripVertical, MoreHorizontal } from 'lucide-react';
import { useDraggable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import { formatGbp } from '@/lib/money/pence';
import { formatBoardDay, type BoardDay, type BoardStop } from '@/lib/rounds/week-board';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DayWeather } from '@/components/weather/day-weather';
import type { DayWeather as DayWeatherData } from '@/lib/weather/met-norway';
import { BoardStopCard } from './board-stop-card';

export type ColumnHighlight = 'drop' | 'swap' | 'denied' | 'swap-source' | null;

/** One day: header with its totals, grip and ⋯ menu, then its stops top to bottom. */
export function BoardDayColumn(props: {
  day: BoardDay;
  flashIds: ReadonlySet<string>;
  /** The stop of this day that is in the air, if any. */
  liftedStopId: string | null;
  /** One job of a stop here that is in the air (the stop stays), if any. */
  liftedJobId: string | null;
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
          {props.weather ? <DayWeather weather={props.weather} className="mt-0.5" /> : null}
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
        {day.stops.map((stop) => (
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
            />
            {stop.id === props.liftedStopId ? null : gapAt(++othersSeen)}
          </Fragment>
        ))}
      </div>
    </section>
  );
}
