'use client';

import { useMemo, useState } from 'react';
import { DndContext, DragOverlay, useDroppable, type DragEndEvent, type DragOverEvent, type DragStartEvent } from '@dnd-kit/core';
import { ChevronDown, Search, UsersRound } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, KeyFigure } from '@/components/look';
import { toneClasses, type Tone } from '@/components/look/tones';
import { useStoredFlag } from '@/components/rounds/use-stored-flag';
import { Button } from '@/components/ui/button';
import {
  JOB_STATE,
  LANES_UP_TO,
  canGive,
  canMove,
  countJobs,
  countLine,
  dayLanes,
  dayOrderAfterLaneDrop,
  firstName,
  flattenDay,
  jobState,
  orderAfterDrop,
  pickPeople,
  workerColours,
  type CalendarWorker,
  type DayLane,
  type PeopleShow,
  type PeopleSort,
  type ProCalendarJob,
} from '@/lib/jobs/pro-calendar';
import type { Ymd } from '@/lib/rounds/dates';
import { cn } from '@/lib/utils';
import { calendarCollision, dropId, hoverFromEvent, useCalendarSensors, type CalendarDrag, type Hover } from './calendar-dnd';
import { GivePicker, type AskGive, type GiveRequest } from './give-picker';
import { JobList } from './job-list';
import { NO_DATE_KEY } from './no-date-toggle';
import { DragCopy, jobName, moveOptionsFrom, type MoveOption } from './pro-job-card';
import { useCalendarJobs } from './use-calendar-jobs';

const EVERYONE_KEY = 'ww-pro-calendar-everyone';
const LIST_KEY = 'ww-pro-calendar-day-list';
const TRAY = 'tray';
/** Dots on a person's row, one per job; past this it says "+N". */
const ROW_DOTS = 10;

type Shared = {
  lifted: ReadonlySet<string>;
  gapHeight: number;
  colours: ReadonlyMap<string, Tone>;
  workers: ReadonlyArray<CalendarWorker>;
  moveOptions: ReadonlyArray<MoveOption>;
  locked: boolean;
  date: Ymd;
  onMove: (job: ProCalendarJob, date: Ymd | null) => void;
  onAskGive: AskGive;
};

function giveAllOf(lane: DayLane): string[] {
  return lane.jobs.filter((job) => canGive(job) && jobState(job) !== 'done').map((job) => job.id);
}

function GiveAllButton(props: { lane: DayLane; date: Ymd | null; shared: Shared; className?: string }) {
  const ids = giveAllOf(props.lane);
  if (ids.length === 0 || props.shared.workers.length === 0) return null;
  const whose = props.lane.workerId ? `${firstName(props.lane.name)}'s` : 'these';
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn('h-7 px-2 text-xs', props.className)}
      onClick={(e) => {
        e.stopPropagation();
        props.shared.onAskGive({
          ids,
          what: `${whose} ${ids.length} ${ids.length === 1 ? 'job' : 'jobs'}`,
          currentId: props.lane.workerId,
          date: props.date,
        });
      }}
    >
      Give all
    </Button>
  );
}

/** A column of jobs: someone's lane, the jobs no one has yet, or the jobs with no date. */
function Lane(props: {
  lane: DayLane;
  accepting: boolean;
  receiving: boolean;
  gapIndex: number | null;
  fill?: boolean;
  shared: Shared;
}) {
  const { lane, shared } = props;
  const { setNodeRef } = useDroppable({ id: dropId(lane.key), disabled: !props.accepting });
  const tray = lane.key === TRAY;
  const none = lane.key === 'none';
  const first = firstName(lane.name);
  const empty = tray
    ? 'Drag a job here to take its date off'
    : none
      ? 'Everything has someone'
      : `Nothing for ${first}. Drag a job here to give it to them.`;
  return (
    <section
      ref={setNodeRef}
      data-drop={lane.key}
      aria-label={tray ? 'No date yet' : `${lane.name}'s jobs`}
      className={cn(
        'flex min-w-0 flex-col rounded-2xl border bg-muted/30 transition-colors',
        none ? 'border-(--tone-amber-line) bg-(--tone-amber-soft)/40' : 'border-border',
        tray && 'border-dashed bg-muted/50',
        props.fill && 'min-h-0 flex-1',
        props.receiving && 'border-primary bg-primary/5',
      )}
    >
      <header className="flex items-center gap-3 border-b border-border px-3 py-3">
        {tray ? null : <Avatar name={none ? '?' : lane.name} tone={lane.colour} size="md" />}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold">{tray ? 'No date yet' : lane.name}</h3>
          <p className="text-xs text-muted-foreground tabular-nums">
            {tray ? `${lane.jobs.length} to put on a day` : none ? `${lane.jobs.length} to give to someone` : countLine(lane.jobs)}
          </p>
        </div>
        {tray ? null : <GiveAllButton lane={lane} date={shared.date} shared={shared} />}
      </header>
      <div className={cn('min-h-24 flex-1 space-y-2 p-3', props.fill && 'overflow-y-auto')}>
        <JobList
          from={lane.key}
          date={tray ? null : shared.date}
          jobs={lane.jobs}
          lifted={shared.lifted}
          gapIndex={props.gapIndex}
          gapHeight={shared.gapHeight}
          showWorker={tray}
          colours={shared.colours}
          workers={shared.workers}
          moveOptions={shared.moveOptions}
          canDrag={(job) => !shared.locked && jobState(job) !== 'done'}
          groupLift={(jobs) => (shared.locked ? [] : jobs.filter((job) => jobState(job) !== 'done').map((job) => job.id))}
          emptyText={empty}
          onMove={shared.onMove}
          onAskGive={shared.onAskGive}
        />
      </div>
    </section>
  );
}

/** One dot per job in its state's colour: a person's day at a glance. */
function JobDots({ jobs }: { jobs: readonly ProCalendarJob[] }) {
  const shown = flattenDay(jobs).slice(0, ROW_DOTS);
  return (
    <span className="flex items-center gap-0.5" aria-hidden>
      {shown.map((job) => (
        <span key={job.id} className={cn('size-2 rounded-full', toneClasses(JOB_STATE[jobState(job)].tone).solid)} />
      ))}
      {jobs.length > ROW_DOTS ? <span className="ml-0.5 text-[10px] text-muted-foreground">+{jobs.length - ROW_DOTS}</span> : null}
    </span>
  );
}

/**
 * A person on the Day list: who, how their day stands, and their first job. Drop a job on the row to give it to
 * them; open the row to see their jobs in order and drag them about.
 */
function PersonRow(props: {
  lane: DayLane;
  open: boolean;
  onToggle: () => void;
  accepting: boolean;
  receiving: boolean;
  gapIndex: number | null;
  shared: Shared;
}) {
  const { lane, shared } = props;
  const { setNodeRef } = useDroppable({ id: dropId(lane.key), disabled: !props.accepting });
  const counts = countJobs(lane.jobs);
  const next = flattenDay(lane.jobs).find((job) => jobState(job) !== 'done');
  return (
    <section
      ref={setNodeRef}
      data-drop={lane.key}
      aria-label={`${lane.name}: ${countLine(lane.jobs)}`}
      className={cn(
        'rounded-xl border border-transparent transition-colors',
        props.open && 'border-border bg-muted/30',
        props.receiving && 'border-primary bg-primary/5',
      )}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={props.open}
        onClick={props.onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            props.onToggle();
          }
        }}
        className="group flex min-h-13 cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <Avatar name={lane.name} tone={lane.colour} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{lane.name}</span>
            {lane.jobs.length > 0 ? <JobDots jobs={lane.jobs} /> : null}
          </p>
          <p className="truncate text-xs text-muted-foreground tabular-nums">
            {lane.jobs.length === 0
              ? 'Free'
              : `${counts.total} ${counts.total === 1 ? 'job' : 'jobs'}${counts.done > 0 ? ` · ${counts.done} done` : ''}${
                  counts.notSent > 0 ? ` · ${counts.notSent} not sent` : ''
                }${next ? ` · Next: ${next.time ? `${next.time} ` : ''}${jobName(next)}` : ''}`}
          </p>
        </div>
        <GiveAllButton
          lane={lane}
          date={shared.date}
          shared={shared}
          className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
        />
        {lane.jobs.length > 0 ? (
          <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', !props.open && '-rotate-90')} aria-hidden />
        ) : null}
      </div>
      {props.open && lane.jobs.length > 0 ? (
        <div className="space-y-2 px-2.5 pb-2.5">
          <JobList
            from={lane.key}
            date={shared.date}
            jobs={lane.jobs}
            lifted={shared.lifted}
            gapIndex={props.gapIndex}
            gapHeight={shared.gapHeight}
            showWorker={false}
            colours={shared.colours}
            workers={shared.workers}
            moveOptions={shared.moveOptions}
            canDrag={(job) => !shared.locked && jobState(job) !== 'done'}
            groupLift={(jobs) => (shared.locked ? [] : jobs.filter((job) => jobState(job) !== 'done').map((job) => job.id))}
            emptyText=""
            onMove={shared.onMove}
            onAskGive={shared.onAskGive}
          />
        </div>
      ) : null}
    </section>
  );
}

function Segmented<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={props.label} className="inline-flex rounded-full border border-border bg-muted/50 p-0.5">
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={props.value === option.value}
          onClick={() => props.onChange(option.value)}
          className={cn(
            'rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors',
            props.value === option.value ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * One day. Two layouts:
 * - Lanes (a small team): like the Rounds day plan with a team, a lane per person, the jobs no one has first.
 * - List (a big team): the jobs to give out on the left, everyone on the right as a row you can search, filter to
 *   who is working or free, and sort by fewest jobs. Drop a job on a person to give it to them; open a person to
 *   see and reorder their day.
 */
export function ProDayLanes(props: {
  date: Ymd;
  today: Ymd;
  jobs: ProCalendarJob[];
  undated: ProCalendarJob[];
  workers: CalendarWorker[];
}) {
  const incoming = useMemo(() => [...props.jobs, ...props.undated], [props.jobs, props.undated]);
  const pageWindow = useMemo(() => ({ from: props.date, to: props.date }), [props.date]);
  const { jobs, saving, place, give } = useCalendarJobs(incoming, pageWindow);
  const [trayOpen] = useStoredFlag(NO_DATE_KEY, false);
  const [everyoneFlag, setEveryone] = useStoredFlag(EVERYONE_KEY, false);
  const [listMode, setListMode] = useStoredFlag(LIST_KEY, props.workers.length > LANES_UP_TO);
  const sensors = useCalendarSensors();
  const [drag, setDrag] = useState<CalendarDrag | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [gapHeight, setGapHeight] = useState(72);
  const [asking, setAsking] = useState<GiveRequest | null>(null);
  const [query, setQuery] = useState('');
  const [show, setShow] = useState<PeopleShow>('working');
  const [sort, setSort] = useState<PeopleSort>('name');
  const [openRows, setOpenRows] = useState<ReadonlySet<string>>(new Set());
  const colours = useMemo(() => workerColours(props.workers), [props.workers]);

  const dayJobs = jobs.filter((job) => job.date === props.date);
  const undated = jobs.filter((job) => job.date === null);
  // With nothing booked there would be nowhere to drop, so everyone's lane shows.
  const everyone = listMode || everyoneFlag || dayJobs.length === 0;
  const lanes: DayLane[] = dayLanes(dayJobs, props.workers, everyone);
  const noneLane: DayLane = lanes.find((lane) => lane.key === 'none') ?? { key: 'none', workerId: null, name: 'No one yet', colour: 'amber', jobs: [] };
  const trayLane: DayLane | null = trayOpen && undated.length > 0 ? { key: TRAY, workerId: null, name: 'No date yet', colour: 'slate', jobs: undated } : null;
  const allLanes = [...lanes, ...(trayLane ? [trayLane] : [])];
  const hiddenPeople = props.workers.filter((worker) => !lanes.some((lane) => lane.workerId === worker.id)).length;
  const totals = countJobs(dayJobs);
  const lifted = new Set(drag?.jobIds ?? []);
  const moveOptions = moveOptionsFrom(props.date < props.today ? props.today : props.date, props.today);
  const pastDay = props.date < props.today;

  const people = lanes.filter((lane) => lane.workerId !== null);
  const working = people.filter((lane) => lane.jobs.length > 0).length;
  const rows = pickPeople(lanes, { query, show, sort });

  const accepts = (lane: DayLane): boolean => {
    if (!drag) return true;
    if (lane.key === drag.from) return true;
    if (lane.key === TRAY) return true;
    if (pastDay && drag.from === TRAY) return false;
    // A job can't be handed back to no one from here: give it to someone else instead.
    if (lane.key === 'none') return drag.from === TRAY;
    return true;
  };

  const onDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as CalendarDrag | undefined;
    if (!data || saving) return;
    setDrag(data);
    setGapHeight(Math.round(event.active.rect.current.initial?.height ?? 72));
    setHover(null);
  };

  const onDragOver = (event: DragOverEvent) => {
    setHover((current) => hoverFromEvent(event, current, lifted, gapHeight));
  };

  const finish = () => {
    setDrag(null);
    setHover(null);
  };

  const onDragEnd = async (event: DragEndEvent) => {
    const active = drag;
    const landed = hoverFromEvent(event, hover, lifted, gapHeight);
    finish();
    if (!active || !landed || active.jobIds.length === 0) return;
    const lane = allLanes.find((l) => l.key === landed.key);
    if (!lane || !accepts(lane)) return;
    const byId = new Map(jobs.map((job) => [job.id, job] as const));
    const moving = active.jobIds.filter((id) => byId.has(id));
    // A closed row on the list shows no jobs, so whatever is dropped on it goes after the ones it has.
    const closedRow = listMode && lane.workerId !== null && !openRows.has(lane.key);
    const index = closedRow ? lane.jobs.filter((job) => !moving.includes(job.id)).length : landed.index;

    if (lane.key === TRAY) {
      if (active.from === TRAY) {
        const all = flattenDay(undated).map((job) => job.id);
        const ordered = orderAfterDrop(all, moving, index);
        if (ordered.join('|') !== all.join('|')) void place(null, ordered, []);
        return;
      }
      const ids = moving.filter((id) => canMove(byId.get(id)!));
      if (ids.length === 0) {
        toast.error('A job that is under way keeps its day.');
        return;
      }
      const all = flattenDay(undated).map((job) => job.id);
      void place(null, orderAfterDrop(all, ids, index), ids);
      return;
    }

    const laneIds = [noneLane, ...people].map((l) => ({ key: l.key, ids: flattenDay(l.jobs).map((job) => job.id) }));
    const ordered = dayOrderAfterLaneDrop(laneIds, lane.key, moving, index);
    const worker = lane.workerId ? (props.workers.find((w) => w.id === lane.workerId) ?? null) : null;
    const handOver = lane.key !== active.from && lane.workerId !== null;
    const giveIds = handOver ? moving.filter((id) => canGive(byId.get(id)!)) : [];
    if (handOver && (!worker || giveIds.length === 0)) {
      toast.error(
        worker
          ? 'That job is already under way. Open it to change who has it.'
          : `${firstName(lane.name)} can't be given jobs right now. Check them on the Workers page.`,
      );
      return;
    }

    if (active.from === TRAY) {
      if (!(await place(props.date, ordered, moving))) return;
      if (worker && giveIds.length > 0) await give(giveIds, worker);
      return;
    }
    if (worker && giveIds.length > 0 && !(await give(giveIds, worker))) return;
    const before = flattenDay(dayJobs).map((job) => job.id);
    if (ordered.join('|') !== before.join('|')) await place(props.date, ordered, []);
  };

  const moveTo = (job: ProCalendarJob, date: Ymd | null) => {
    const all = flattenDay(jobs.filter((j) => j.date === date && j.id !== job.id)).map((j) => j.id);
    void place(date, [...all, job.id], [job.id]);
  };

  const receivingKey = drag && hover && hover.key !== drag.from ? hover.key : null;
  const shared: Shared = {
    lifted,
    gapHeight,
    colours,
    workers: props.workers,
    moveOptions,
    locked: saving,
    date: props.date,
    onMove: moveTo,
    onAskGive: setAsking,
  };
  const laneProps = (lane: DayLane) => ({
    lane,
    accepting: accepts(lane),
    receiving: receivingKey === lane.key && accepts(lane),
    gapIndex: hover?.key === lane.key ? hover.index : null,
    shared,
  });
  const toggleRow = (key: string) =>
    setOpenRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const receivingName = receivingKey ? allLanes.find((l) => l.key === receivingKey)?.name : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-2xl border border-border bg-card px-5 py-4 shadow-(--look-card-shadow) sm:grid-cols-5">
        <KeyFigure label="Jobs" value={String(totals.total)} />
        <KeyFigure label="No one yet" value={String(totals.noOne + totals.declined)} tone={totals.noOne + totals.declined > 0 ? 'amber' : 'slate'} />
        <KeyFigure label="Given, not sent" value={String(totals.notSent)} tone={totals.notSent > 0 ? 'amber' : 'slate'} />
        <KeyFigure label="People working" value={`${working} of ${props.workers.length}`} />
        <KeyFigure label="Done" value={`${totals.done} of ${totals.total}`} tone="emerald" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          label="Layout"
          value={listMode ? 'list' : 'lanes'}
          options={[
            { value: 'lanes', label: 'Lanes' },
            { value: 'list', label: 'List' },
          ]}
          onChange={(value) => setListMode(value === 'list')}
        />
        {!listMode && (hiddenPeople > 0 || everyoneFlag) && dayJobs.length > 0 ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setEveryone(!everyoneFlag)}>
            <UsersRound className="size-4" />
            {everyoneFlag ? 'Only people with jobs' : `Show everyone (${hiddenPeople} more)`}
          </Button>
        ) : null}
      </div>

      <DndContext
        id="pro-day-dnd"
        sensors={sensors}
        collisionDetection={calendarCollision}
        autoScroll={{ layoutShiftCompensation: false }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={(event) => void onDragEnd(event)}
        onDragCancel={finish}
      >
        {props.workers.length === 0 && dayJobs.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            No jobs on this day, and no one to give them to yet. Add people on the Workers page.
          </p>
        ) : listMode ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
            <div className="flex h-[calc(100vh-19rem)] min-h-96 flex-col gap-3">
              <Lane {...laneProps(noneLane)} fill />
              {trayLane ? <Lane {...laneProps(trayLane)} fill /> : null}
            </div>
            <section className="flex h-[calc(100vh-19rem)] min-h-96 flex-col rounded-2xl border border-border bg-card shadow-(--look-card-shadow)" aria-label="People">
              <header className="space-y-2.5 border-b border-border px-3 py-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={`Find a person (${props.workers.length})`}
                    aria-label="Find a person"
                    className="h-9 w-full rounded-full border border-input bg-transparent pr-3 pl-8 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Segmented
                    label="Show"
                    value={show}
                    options={[
                      { value: 'working', label: `Working (${working})` },
                      { value: 'free', label: `Free (${people.length - working})` },
                      { value: 'everyone', label: `Everyone (${people.length})` },
                    ]}
                    onChange={setShow}
                  />
                  <Segmented
                    label="Sort"
                    value={sort}
                    options={[
                      { value: 'name', label: 'A–Z' },
                      { value: 'fewest', label: 'Fewest jobs' },
                    ]}
                    onChange={setSort}
                  />
                </div>
              </header>
              <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5">
                {rows.map((lane) => (
                  <PersonRow key={lane.key} {...laneProps(lane)} open={openRows.has(lane.key)} onToggle={() => toggleRow(lane.key)} />
                ))}
                {rows.length === 0 ? (
                  <p className="px-3 py-10 text-center text-sm text-muted-foreground">
                    {query ? 'No one by that name.' : show === 'working' ? 'No one has work on this day yet. Drop a job on someone under Free.' : 'No one here.'}
                  </p>
                ) : null}
              </div>
            </section>
          </div>
        ) : (
          <div className="grid auto-cols-[minmax(280px,1fr)] grid-flow-col gap-4 overflow-x-auto pb-2">
            {allLanes.map((lane) => (
              <Lane key={lane.key} {...laneProps(lane)} />
            ))}
          </div>
        )}
        <DragOverlay dropAnimation={null}>
          {drag ? (
            <div style={{ width: drag.kind === 'job' ? 280 : undefined }}>
              <DragCopy
                drag={drag}
                jobs={jobs}
                colours={colours}
                showWorker={drag.from === TRAY}
                note={
                  receivingKey && receivingKey !== TRAY && receivingKey !== 'none'
                    ? `Give to ${firstName(receivingName)}`
                    : receivingKey === TRAY
                      ? 'Take the date off'
                      : null
                }
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <GivePicker
        request={asking}
        workers={props.workers}
        jobs={jobs}
        colours={colours}
        onClose={() => setAsking(null)}
        onGive={(ids, worker) => void give(ids, worker)}
      />
    </div>
  );
}