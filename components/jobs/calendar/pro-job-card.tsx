'use client';

import { forwardRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useDraggable } from '@dnd-kit/core';
import { ChevronDown, GripVertical } from 'lucide-react';
import { rowHover } from '@/components/look/row-hover';
import { toneClasses, type Tone } from '@/components/look/tones';
import { roundBoxStyle } from '@/components/rounds/round-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  JOB_STATE,
  canGive,
  canMove,
  firstName,
  groupTag,
  holderOf,
  jobState,
  streetOf,
  type CalendarWorker,
  type JobGroupTag,
  type JobState,
  type ProCalendarJob,
} from '@/lib/jobs/pro-calendar';
import { addDays, type Ymd } from '@/lib/rounds/dates';
import { formatBoardDay } from '@/lib/rounds/week-board';
import { cn } from '@/lib/utils';
import type { CalendarDrag } from './calendar-dnd';
import type { AskGive } from './give-picker';

/** A day the card's "Move to" menu offers. */
export type MoveOption = { date: Ymd | null; label: string };

/** The next seven days from `start`, then "No date": what a card's Move to menu offers. */
export function moveOptionsFrom(start: Ymd, today: Ymd): MoveOption[] {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return [
    ...days.map((date) => ({ date, label: date === today ? `Today, ${formatBoardDay(date)}` : formatBoardDay(date) })),
    { date: null, label: 'No date' },
  ];
}

/** The dashed slot a card will land in. */
export function DropGap({ height }: { height: number }) {
  return <div data-drop-gap style={{ height }} className="rounded-xl border-2 border-dashed border-primary/40 bg-primary/5" />;
}

function WorkerChip({ name, colour }: { name: string; colour: Tone }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1 rounded-full bg-muted px-1.5 py-px text-[11px] font-medium text-foreground/80">
      <span className={cn('size-2 shrink-0 rounded-full', toneClasses(colour).solid)} aria-hidden />
      <span className="truncate">{firstName(name)}</span>
    </span>
  );
}

function NoOneChip() {
  return (
    <span className="inline-flex items-center rounded-full bg-(--tone-amber-soft) px-1.5 py-px text-[11px] font-semibold text-(--tone-amber-text)">
      No one yet
    </span>
  );
}

/**
 * What a job looks like on the calendar: where it is, the reference, what it is, who has it and where it stands.
 * Used in the column, the lane and the copy that follows the pointer. `showWorker` is off in the Day lanes, where
 * the lane already says who.
 */
export function ProJobFace({
  job,
  colours,
  showWorker = true,
}: {
  job: ProCalendarJob;
  colours: ReadonlyMap<string, Tone>;
  showWorker?: boolean;
}) {
  const state = jobState(job);
  const meta = JOB_STATE[state];
  const holder = holderOf(job);
  const street = jobName(job);
  const second = [job.postcode, job.reference && job.reference !== job.title ? job.reference : null].filter(Boolean).join(' · ');
  // "No one yet" is already said by the chip, or by the lane the card sits in.
  const word =
    state === 'no_one'
      ? null
      : state === 'declined' && job.worker
        ? `Declined by ${firstName(job.worker)}`
        : meta.label;
  return (
    <>
      <span className={cn('absolute inset-y-0 left-0 w-1', toneClasses(meta.tone).solid)} aria-hidden />
      <span className="flex items-start gap-1.5">
        <span className="line-clamp-2 min-w-0 flex-1 text-sm leading-snug font-semibold break-words text-foreground">{street}</span>
        {job.time ? <span className="shrink-0 pt-px text-xs tabular-nums text-muted-foreground">{job.time}</span> : null}
      </span>
      {second ? <span className="block truncate text-xs text-muted-foreground">{second}</span> : null}
      {job.detail ? <span className="block truncate text-xs text-muted-foreground">{job.detail}</span> : null}
      <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
        {showWorker ? holder ? <WorkerChip name={job.worker ?? 'Someone'} colour={colours.get(holder) ?? 'slate'} /> : <NoOneChip /> : null}
        {word ? <span className={cn('font-medium', toneClasses(meta.tone).text)}>{word}</span> : null}
        {job.priority === 'emergency' ? (
          <span className="rounded-full bg-(--tone-rose-soft) px-1.5 py-px text-[11px] font-semibold text-(--tone-rose-text)">Emergency</span>
        ) : job.priority === 'high' ? (
          <span className="rounded-full bg-(--tone-amber-soft) px-1.5 py-px text-[11px] font-semibold text-(--tone-amber-text)">High</span>
        ) : null}
      </span>
    </>
  );
}

export const CARD_BOX = 'relative block w-full overflow-hidden rounded-xl border border-border bg-card py-2 pr-2.5 pl-3.5 text-left';

/** What follows the pointer while you drag: the card itself, or the group as a pill in its colour. */
export function DragCopy({
  drag,
  jobs,
  colours,
  showWorker,
  note,
}: {
  drag: CalendarDrag;
  jobs: ReadonlyArray<ProCalendarJob>;
  colours: ReadonlyMap<string, Tone>;
  showWorker?: boolean;
  /** Said above the card when the drop does something you might not expect ("Gives it to Dave"). */
  note?: string | null;
}) {
  const first = jobs.find((job) => job.id === drag.jobIds[0]);
  if (!first) return null;
  if (drag.kind === 'group') {
    const tag = groupTag(first);
    return (
      <div className="relative">
        {note ? <DragNote text={note} /> : null}
        <div
          className="rounded-full px-4 py-2 text-sm font-bold whitespace-nowrap text-white shadow-xl"
          style={{ backgroundColor: tag?.colour ?? 'var(--primary)' }}
        >
          {tag?.name ?? 'Group'} · {drag.jobIds.length} {drag.jobIds.length === 1 ? 'job' : 'jobs'}
        </div>
      </div>
    );
  }
  return (
    <div className="relative shadow-xl">
      {note ? <DragNote text={note} /> : null}
      <div className={CARD_BOX}>
        <ProJobFace job={first} colours={colours} showWorker={showWorker} />
      </div>
    </div>
  );
}

function DragNote({ text }: { text: string }) {
  return (
    <span className="absolute -top-7 left-0 rounded-md bg-primary px-2 py-0.5 text-xs font-bold whitespace-nowrap text-primary-foreground">
      {text}
    </span>
  );
}

/** "14 High Street", or the reference: what a job is called in a message. */
export function jobName(job: ProCalendarJob): string {
  return job.title === job.reference ? job.title : streetOf(job.title, job.postcode);
}

/** A job on the calendar. Click for Open, Move to and Give to; hold and drag to move it. */
export function ProJobCard(props: {
  job: ProCalendarJob;
  from: string;
  draggable: boolean;
  lifted: boolean;
  showWorker?: boolean;
  colours: ReadonlyMap<string, Tone>;
  canGiveOut: boolean;
  moveOptions: ReadonlyArray<MoveOption>;
  onMove: (job: ProCalendarJob, date: Ymd | null) => void;
  onAskGive: AskGive;
}) {
  const router = useRouter();
  const { job } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const drag: CalendarDrag = { kind: 'job', jobIds: [job.id], from: props.from };
  const { attributes, listeners, setNodeRef } = useDraggable({ id: `job:${job.id}`, data: drag, disabled: !props.draggable });
  const state = jobState(job);
  const dimmed = state === 'done';
  const movable = canMove(job);
  const giveable = canGive(job) && props.canGiveOut;
  const holder = holderOf(job);
  const moveTo = props.moveOptions.filter((option) => option.date !== job.date);

  return (
    <div
      data-job-id={job.id}
      className={cn(
        // Cards off screen are skipped until they scroll in, so a day with hundreds of jobs stays quick.
        'relative overflow-hidden rounded-xl border border-border bg-card [contain-intrinsic-size:auto_84px] [content-visibility:auto]',
        rowHover,
        dimmed && 'opacity-60',
        props.lifted && 'hidden',
      )}
      title={job.customer ?? undefined}
    >
      <DropdownMenu
        open={menuOpen}
        // Opened by the click below, not on pointer-down, so a drag never opens the menu.
        onOpenChange={(open) => {
          if (!open) setMenuOpen(false);
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            ref={setNodeRef}
            type="button"
            {...attributes}
            {...listeners}
            aria-roledescription="draggable job"
            onClick={() => setMenuOpen(true)}
            className={cn(
              'relative block w-full py-2 pr-2.5 pl-3.5 text-left touch-manipulation focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none',
              props.draggable && 'cursor-grab',
            )}
          >
            <ProJobFace job={job} colours={props.colours} showWorker={props.showWorker} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56">
          <DropdownMenuLabel className="space-y-0.5">
            <span className="block truncate">{job.reference ?? 'Job'}</span>
            {job.customer ? <span className="block truncate text-xs font-normal text-muted-foreground">{job.customer}</span> : null}
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => router.push(`/jobs/${job.id}`)}>Open job</DropdownMenuItem>
          {movable && moveTo.length > 0 ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-44">
                {moveTo.map((option) => (
                  <DropdownMenuItem key={option.date ?? 'none'} onSelect={() => props.onMove(job, option.date)}>
                    {option.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
          {giveable ? (
            <DropdownMenuItem
              // After the menu has closed, so the picker gets the focus.
              onSelect={() => setTimeout(() => props.onAskGive({ ids: [job.id], what: jobName(job), currentId: holder, date: job.date }), 0)}
            >
              {holder ? 'Give to someone else…' : 'Give to…'}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Same look as the Rounds person chip, but the label is used as it is ("No one yet", not "No"). */
const ChipButton = forwardRef<
  HTMLButtonElement,
  { label: string; colour: Tone; count?: number | string; size?: 'sm' | 'md' } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>
>(function ChipButton({ label, colour, count, size = 'md', className, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      className={cn(
        'inline-flex max-w-full items-center rounded-full font-medium text-foreground transition-colors',
        size === 'sm'
          ? 'h-5 gap-1 bg-muted px-1.5 text-[11px] hover:bg-muted/70'
          : 'h-6 gap-1.5 border border-border bg-card px-2 text-xs shadow-xs hover:bg-muted',
        'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-100',
        className,
      )}
      {...rest}
    >
      <span className={cn('size-2 shrink-0 rounded-full', toneClasses(colour).solid)} aria-hidden="true" />
      <span className="truncate">{label}</span>
      {count !== undefined ? <span className="tabular-nums text-muted-foreground">{count}</span> : null}
      {size === 'md' && !disabled ? <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
    </button>
  );
});

/** The person chip on a group or a day: who has it. Click it to give all of it to someone. */
export function GiveAllChip(props: {
  label: string;
  colour: Tone;
  count?: number | string;
  size?: 'sm' | 'md';
  /** The jobs that can be handed over; none means the chip is just a label. */
  giveIds: string[];
  currentId: string | null;
  /** What the picker calls the work ("Tesco Express", "Dave's 4 jobs"). */
  what: string;
  date: Ymd | null;
  canGiveOut: boolean;
  title: string;
  onAskGive: AskGive;
}) {
  const disabled = props.giveIds.length === 0 || !props.canGiveOut;
  return (
    <ChipButton
      label={props.label}
      colour={props.colour}
      count={props.count}
      size={props.size}
      disabled={disabled}
      title={props.title}
      aria-label={`${props.title}${disabled ? '' : '. Give to someone'}`}
      onClick={() => props.onAskGive({ ids: props.giveIds, what: props.what, currentId: props.currentId, date: props.date })}
    />
  );
}

/** "3 done · 2 no one yet": how a folded group stands, without opening it. */
function groupSummary(jobs: readonly ProCalendarJob[]): { label: string; tone: Tone }[] {
  const counts = new Map<JobState, number>();
  for (const job of jobs) counts.set(jobState(job), (counts.get(jobState(job)) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([state, count]) => ({ label: `${count} ${JOB_STATE[state].label.toLowerCase()}`, tone: JOB_STATE[state].tone }));
}

/**
 * Jobs from one group on one day, in the same coloured box a round uses, with who has them. A big group can fold to
 * its header (where its jobs stand, in one line) so a busy day stays readable; the whole group still drags.
 */
export function ProGroupBox(props: {
  group: JobGroupTag;
  jobs: ProCalendarJob[];
  /** The jobs that go with the box when its handle is dragged. None: no handle. */
  liftIds: string[];
  from: string;
  date: Ymd | null;
  lifted: boolean;
  folded: boolean;
  onFold: (folded: boolean) => void;
  showWorker?: boolean;
  colours: ReadonlyMap<string, Tone>;
  workers: ReadonlyArray<CalendarWorker>;
  canGiveOut: boolean;
  onAskGive: AskGive;
  children: ReactNode;
}) {
  const drag: CalendarDrag = { kind: 'group', jobIds: props.liftIds, from: props.from };
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: `group:${props.from}:${props.group.id}:${props.jobs[0]?.id ?? ''}`,
    data: drag,
    disabled: props.liftIds.length === 0,
  });
  const n = props.jobs.length;
  const holders = new Set(props.jobs.map(holderOf));
  const only = holders.size === 1 ? [...holders][0]! : undefined;
  const giveIds = props.jobs.filter(canGive).map((job) => job.id);
  const onlyName = only ? (props.workers.find((w) => w.id === only)?.name ?? props.jobs.find((j) => holderOf(j) === only)?.worker ?? 'Someone') : null;

  return (
    <div
      role="group"
      aria-label={`${props.group.name}: ${n} ${n === 1 ? 'job' : 'jobs'}`}
      data-group-id={props.group.id}
      // Folded, the box stands in for its jobs when the drop place is worked out.
      data-folded-jobs={props.folded ? props.jobs.map((job) => job.id).join(' ') : undefined}
      style={roundBoxStyle(props.group.colour)}
      className={cn('space-y-2 rounded-2xl border p-2 transition-opacity', props.lifted && 'opacity-40')}
    >
      <div className="px-0.5">
        <div className="flex items-start gap-1">
          {props.liftIds.length > 0 ? (
            <button
              ref={setNodeRef}
              type="button"
              aria-label={`Drag all of ${props.group.name}`}
              className="-ml-0.5 shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-muted"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="size-3.5" />
            </button>
          ) : null}
          <p className="line-clamp-2 min-w-0 flex-1 text-[13px] leading-5 font-semibold break-words text-foreground">{props.group.name}</p>
          <button
            type="button"
            onClick={() => props.onFold(!props.folded)}
            aria-expanded={!props.folded}
            aria-label={props.folded ? `Show the ${n} jobs in ${props.group.name}` : `Fold ${props.group.name}`}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted"
          >
            <ChevronDown className={cn('size-4 transition-transform', props.folded && '-rotate-90')} />
          </button>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          {props.showWorker === false ? null : (
            <GiveAllChip
              label={only === undefined ? 'Mixed' : only === null ? 'No one yet' : firstName(onlyName)}
              colour={only === undefined ? 'slate' : only === null ? 'amber' : (props.colours.get(only) ?? 'slate')}
              count={only === undefined ? holders.size : undefined}
              giveIds={giveIds}
              currentId={only ?? null}
              what={props.group.name}
              date={props.date}
              canGiveOut={props.canGiveOut}
              title={`Who has ${props.group.name}`}
              onAskGive={props.onAskGive}
            />
          )}
          <span className="text-xs tabular-nums text-muted-foreground">
            {n} {n === 1 ? 'job' : 'jobs'}
          </span>
        </div>
        {props.folded ? (
          <button
            type="button"
            onClick={() => props.onFold(false)}
            className="mt-1.5 flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg bg-card/70 px-2 py-1.5 text-left text-xs hover:bg-card"
          >
            {groupSummary(props.jobs).map((part) => (
              <span key={part.label} className="inline-flex items-center gap-1">
                <span className={cn('size-2 rounded-full', toneClasses(part.tone).solid)} aria-hidden />
                {part.label}
              </span>
            ))}
            <span className="ml-auto font-medium text-primary">Show</span>
          </button>
        ) : null}
      </div>
      {props.folded ? null : props.children}
    </div>
  );
}

