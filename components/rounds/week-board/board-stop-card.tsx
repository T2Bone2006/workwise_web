'use client';

import { useState, type JSX } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { ChevronDown, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatGbp } from '@/lib/money/pence';
import type { BoardJob, BoardStop } from '@/lib/rounds/week-board';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const BAR: Record<BoardStop['state'], string> = {
  planned: 'bg-(--tone-sky-solid)',
  underway: 'bg-(--tone-sky-solid)',
  part_done: 'bg-(--tone-amber-solid)',
  done: 'bg-(--tone-emerald-solid)',
  skipped: 'bg-(--tone-rose-solid)',
};

const PAID_WORD: Record<NonNullable<BoardStop['paid']>, string> = {
  paid: 'Paid',
  part: 'Part paid',
  unpaid: 'Unpaid',
};

/** What a stop looks like. Used by the card in its column and by the copy that floats under the mouse. */
export function StopCardFace(props: { stop: BoardStop }): JSX.Element {
  const { stop } = props;
  return (
    <>
      <span className={cn('absolute inset-y-0 left-0 w-1', BAR[stop.state])} aria-hidden />
      {stop.untoldChangeId ? (
        <span className="absolute right-2 top-0 rounded-b-md bg-(--tone-amber-soft) px-1.5 text-[10px] font-bold leading-4 text-(--tone-amber-text) ring-1 ring-(--tone-amber-line)">
          Not told
        </span>
      ) : null}
      <span className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{stop.name}</span>
        {stop.jobCount > 1 ? (
          <span className="shrink-0 rounded bg-(--tone-indigo-soft) px-1 text-[10px] font-bold leading-4 text-(--tone-indigo-text)">
            {stop.jobCount} jobs
          </span>
        ) : null}
        {stop.time ? <span className="shrink-0 text-xs text-muted-foreground">{stop.time}</span> : null}
      </span>
      <span className="block truncate text-xs text-muted-foreground">
        {[stop.street, stop.postcode].filter(Boolean).join(' · ')}
      </span>
      <span className="block truncate text-xs text-muted-foreground">{stop.services}</span>
      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
        <span className="font-semibold text-foreground">{formatGbp(stop.amount)}</span>
        {stop.paid ? (
          <span
            className={cn(
              'rounded-full px-1.5 text-[11px] font-medium leading-4',
              stop.paid === 'paid' ? 'text-(--tone-emerald-text)' : 'bg-(--tone-rose-soft) text-(--tone-rose-text)',
            )}
          >
            {PAID_WORD[stop.paid]}
          </span>
        ) : null}
        {stop.reply ? (
          <span className="truncate rounded bg-(--tone-amber-soft) px-1.5 font-semibold text-(--tone-amber-text)">
            {stop.reply}
          </span>
        ) : null}
      </span>
    </>
  );
}

export const CARD_BOX =
  'relative block w-full overflow-hidden rounded-xl border border-border bg-card pl-3.5 pr-2.5 py-2 text-left';

/** One job inside an opened combined card: its own grip (drag just this job) and its own menu. */
function JobRow(props: {
  stop: BoardStop;
  job: BoardJob;
  date: string;
  lifted: boolean;
  locked: boolean;
  onOpen: (stop: BoardStop) => void;
  onMoveJob: (stop: BoardStop, jobId: string) => void;
  onTell: (changeId: string) => void;
}): JSX.Element {
  const { job } = props;
  const canDrag = job.movable && !props.locked;
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: `job:${job.id}`,
    data: { date: props.date, stopId: props.stop.id },
    disabled: !canDrag,
  });
  const dimmed = job.state === 'done' || job.state === 'skipped';
  return (
    <div
      data-job-id={job.id}
      className={cn(
        'flex items-center gap-1 border-t border-border/50 py-1 pl-2.5 pr-1.5 text-xs',
        dimmed && 'opacity-60',
        props.lifted && 'opacity-30',
      )}
    >
      {canDrag ? (
        <button
          {...attributes}
          {...listeners}
          ref={setNodeRef}
          type="button"
          aria-label={`Drag ${job.services} to another day`}
          className="shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-muted"
        >
          <GripVertical className="size-3.5" />
        </button>
      ) : (
        <span className="w-5 shrink-0" />
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-muted/60">
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">{job.services}</span>
            <span className="shrink-0 text-muted-foreground">{formatGbp(job.amount)}</span>
            {job.state === 'done' ? (
              <span className="shrink-0 text-(--tone-emerald-text)">{job.paid ? PAID_WORD[job.paid] : 'Done'}</span>
            ) : job.state === 'skipped' ? (
              <span className="shrink-0 text-(--tone-rose-text)">Skipped</span>
            ) : null}
            {job.untoldChangeId ? (
              <span className="shrink-0 rounded bg-(--tone-amber-soft) px-1 text-[10px] font-bold text-(--tone-amber-text)">
                Not told
              </span>
            ) : null}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-52">
          <DropdownMenuItem onSelect={() => props.onOpen(props.stop)}>Open job</DropdownMenuItem>
          {job.movable ? (
            <DropdownMenuItem onSelect={() => props.onMoveJob(props.stop, job.id)}>
              Move just this job…
            </DropdownMenuItem>
          ) : null}
          {job.untoldChangeId ? (
            <DropdownMenuItem onSelect={() => props.onTell(job.untoldChangeId as string)}>
              Tell customers about this move
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** A stop on the board. Click for Open job / Move to day…; hold and drag to move it; ▾ opens a combined card into its jobs. */
export function BoardStopCard(props: {
  stop: BoardStop;
  date: string;
  /** It just moved here: ring it for a moment so you can see where it went. */
  flash: boolean;
  /** This is the one in the air: its place is taken by a placeholder. */
  lifted: boolean;
  /** One job of this card is in the air (the card itself stays). */
  liftedJobId: string | null;
  /** A card is being dragged over it and would join it (same house). */
  join: boolean;
  /** Dragging is off (a move is saving). */
  locked: boolean;
  onOpen: (stop: BoardStop) => void;
  onMove: (stop: BoardStop) => void;
  onMoveJob: (stop: BoardStop, jobId: string) => void;
  onTell: (changeId: string) => void;
}): JSX.Element {
  const { stop } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const [showJobs, setShowJobs] = useState(false);
  const dimmed = stop.state === 'done' || stop.state === 'skipped' || stop.state === 'part_done';
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: `stop:${stop.id}`,
    data: { date: props.date },
    disabled: !stop.movable || props.locked,
  });
  const combined = stop.jobCount > 1;

  return (
    <div
      data-stop-id={stop.id}
      className={cn(
        'relative overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:shadow-md',
        dimmed && 'opacity-60',
        props.flash && 'ring-2 ring-primary',
        props.join && 'bg-primary/10 ring-2 ring-primary',
        props.lifted && 'hidden',
      )}
    >
      <DropdownMenu
        open={menuOpen}
        // Opening is done by the click below, not by Radix's pointer-down, so a drag never opens the menu.
        onOpenChange={(open) => {
          if (!open) setMenuOpen(false);
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            {...attributes}
            {...listeners}
            ref={setNodeRef}
            type="button"
            data-stop-main
            aria-roledescription="draggable job"
            onClick={() => setMenuOpen(true)}
            className={cn(
              'relative block w-full pl-3.5 pr-2.5 py-2 text-left',
              'touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
              stop.movable && !props.locked ? 'cursor-grab' : props.locked ? 'cursor-wait' : '',
            )}
          >
            <StopCardFace stop={stop} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-52">
          <DropdownMenuItem onSelect={() => props.onOpen(stop)}>Open job</DropdownMenuItem>
          {stop.movable ? (
            <DropdownMenuItem onSelect={() => props.onMove(stop)}>
              {combined ? 'Move all jobs to day…' : 'Move to day…'}
            </DropdownMenuItem>
          ) : null}
          {stop.untoldChangeId ? (
            <DropdownMenuItem onSelect={() => props.onTell(stop.untoldChangeId as string)}>
              Tell customers about this move
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {combined ? (
        <>
          <button
            type="button"
            onClick={() => setShowJobs((open) => !open)}
            aria-expanded={showJobs}
            className="flex w-full items-center justify-center gap-1 border-t border-border/50 py-0.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted/60"
          >
            {showJobs ? 'Hide jobs' : `Show ${stop.jobCount} jobs`}
            <ChevronDown className={cn('size-3 transition-transform', showJobs && 'rotate-180')} aria-hidden />
          </button>
          {showJobs
            ? stop.jobs.map((job) => (
                <JobRow
                  key={job.id}
                  stop={stop}
                  job={job}
                  date={props.date}
                  lifted={job.id === props.liftedJobId}
                  locked={props.locked}
                  onOpen={props.onOpen}
                  onMoveJob={props.onMoveJob}
                  onTell={props.onTell}
                />
              ))
            : null}
        </>
      ) : null}
    </div>
  );
}
