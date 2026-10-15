'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { DndContext, DragOverlay, useDroppable, type DragEndEvent, type DragOverEvent, type DragStartEvent } from '@dnd-kit/core';
import { ChevronLeft, ChevronRight, Loader2, UsersRound } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar } from '@/components/look';
import { toneClasses, type Tone } from '@/components/look/tones';
import { useStoredFlag } from '@/components/rounds/use-stored-flag';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { loadProCalendarWeeks } from '@/lib/actions/pro-calendar';
import {
  canGive,
  canMove,
  countJobs,
  countLine,
  filterJobs,
  firstName,
  flattenDay,
  holderOf,
  jobState,
  nameMatches,
  orderAfterFilteredDrop,
  peopleOn,
  workerColours,
  type CalendarWorker,
  type DayPerson,
  type PersonFilter,
  type ProCalendarJob,
} from '@/lib/jobs/pro-calendar';
import { addDays, isoWeekday, type Ymd } from '@/lib/rounds/dates';
import {
  BOARD_LOAD_STEP_WEEKS,
  extendRange,
  formatBoardDay,
  initialRange,
  mondayOf,
  rangeEnd,
  type BoardRange,
} from '@/lib/rounds/week-board';
import { cn } from '@/lib/utils';
import { calendarCollision, dropId, hoverFromEvent, useCalendarSensors, type CalendarDrag, type Hover } from './calendar-dnd';
import { calendarHref } from './calendar-view-picker';
import { GivePicker, type AskGive, type GiveRequest } from './give-picker';
import { JobList } from './job-list';
import { NO_DATE_KEY } from './no-date-toggle';
import { DragCopy, GiveAllChip, moveOptionsFrom, type MoveOption } from './pro-job-card';
import { useCalendarJobs } from './use-calendar-jobs';

/** How close (px) to either end of the board before the next weeks are loaded. */
const EDGE_PX = 400;
/** The space between weeks. A week lined up on screen starts just after it, so the soft edge sits in the gap. */
const WEEK_GAP_PX = 16;
/** Up to this many people, a day shows each one as a chip; more than that and they sit behind "N people". */
const CHIPS_UP_TO = 4;

type Column = {
  key: string;
  date: Ymd | null;
  title: string;
  isToday: boolean;
  isPast: boolean;
  jobs: ProCalendarJob[];
};

function giveableOf(jobs: readonly ProCalendarJob[], holder: string | null): string[] {
  return jobs.filter((job) => holderOf(job) === holder && canGive(job) && jobState(job) !== 'done').map((job) => job.id);
}

/** Everyone working a day, in a list you can search: open someone's week, or give all their jobs that day away. */
function DayPeopleList(props: {
  date: Ymd;
  people: DayPerson[];
  jobs: ProCalendarJob[];
  colours: ReadonlyMap<string, Tone>;
  canGiveOut: boolean;
  onAskGive: AskGive;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const shown = props.people.filter((person) => nameMatches(person.name, query));
  return (
    <Popover onOpenChange={(open) => !open && setQuery('')}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-5 items-center gap-1 rounded-full bg-muted px-1.5 text-[11px] font-medium text-foreground hover:bg-muted/70 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <UsersRound className="size-3" aria-hidden />
          {props.people.length} people
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="border-b border-border px-3 pt-3 pb-2">
          <p className="text-sm font-semibold">Working {formatBoardDay(props.date)}</p>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a person"
            aria-label="Find a person"
            className="mt-2 h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>
        <ul className="max-h-72 overflow-y-auto p-1">
          {shown.map((person) => {
            const ids = giveableOf(props.jobs, person.workerId);
            return (
              <li key={person.workerId} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted">
                <Avatar name={person.name} tone={props.colours.get(person.workerId ?? '') ?? 'slate'} size="sm" />
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline"
                  title={`Show only ${person.name}'s jobs`}
                  onClick={() => router.push(calendarHref('week', props.date, person.workerId ?? 'all'))}
                >
                  {person.name}
                </button>
                <span className="text-xs tabular-nums text-muted-foreground">{person.count}</span>
                {ids.length > 0 && props.canGiveOut ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-xs"
                    onClick={() =>
                      props.onAskGive({ ids, what: `${firstName(person.name)}'s ${ids.length} ${ids.length === 1 ? 'job' : 'jobs'}`, currentId: person.workerId, date: props.date })
                    }
                  >
                    Give
                  </Button>
                ) : null}
              </li>
            );
          })}
          {shown.length === 0 ? <li className="px-2 py-4 text-center text-xs text-muted-foreground">No one by that name.</li> : null}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** Who is working a day: the jobs no one has yet, then each person (or, for a big team, "N people"). */
function DayPeople(props: {
  date: Ymd;
  jobs: ProCalendarJob[];
  colours: ReadonlyMap<string, Tone>;
  canGiveOut: boolean;
  onAskGive: AskGive;
}) {
  const { people, noOne } = peopleOn(props.jobs);
  if (people.length === 0 && noOne === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1" role="group" aria-label="Who is working">
      {noOne > 0 ? (
        <GiveAllChip
          size="sm"
          label="No one"
          colour="amber"
          count={noOne}
          giveIds={giveableOf(props.jobs, null)}
          currentId={null}
          what={`${noOne} ${noOne === 1 ? 'job' : 'jobs'} with no one`}
          date={props.date}
          canGiveOut={props.canGiveOut}
          title={`${noOne} ${noOne === 1 ? 'job has' : 'jobs have'} no one yet`}
          onAskGive={props.onAskGive}
        />
      ) : null}
      {people.length > CHIPS_UP_TO ? (
        <DayPeopleList {...props} people={people} />
      ) : (
        people.map((person) => (
          <GiveAllChip
            key={person.workerId}
            size="sm"
            label={firstName(person.name)}
            colour={props.colours.get(person.workerId ?? '') ?? 'slate'}
            count={person.count}
            giveIds={giveableOf(props.jobs, person.workerId)}
            currentId={person.workerId}
            what={`${firstName(person.name)}'s jobs`}
            date={props.date}
            canGiveOut={props.canGiveOut}
            title={`${person.name} has ${person.count} ${person.count === 1 ? 'job' : 'jobs'}`}
            onAskGive={props.onAskGive}
          />
        ))
      )}
    </div>
  );
}

function WeekColumn(props: {
  column: Column;
  accepting: boolean;
  lifted: ReadonlySet<string>;
  gapIndex: number | null;
  gapHeight: number;
  colours: ReadonlyMap<string, Tone>;
  workers: ReadonlyArray<CalendarWorker>;
  moveOptions: ReadonlyArray<MoveOption>;
  locked: boolean;
  onMove: (job: ProCalendarJob, date: Ymd | null) => void;
  onAskGive: AskGive;
}) {
  const { column } = props;
  const { setNodeRef, isOver } = useDroppable({ id: dropId(column.key), disabled: !props.accepting });
  const tray = column.date === null;
  return (
    <section
      ref={setNodeRef}
      data-drop={column.key}
      data-date={column.date ?? undefined}
      aria-label={column.title}
      className={cn(
        'flex h-[calc(100vh-15rem)] min-h-80 shrink-0 flex-col rounded-2xl border border-border bg-card shadow-(--look-card-shadow)',
        tray
          ? 'w-[220px] border-dashed bg-muted/50 shadow-none'
          : 'w-[200px] @min-[960px]/board:w-auto @min-[960px]/board:min-w-0 @min-[960px]/board:flex-1 @min-[960px]/board:shrink',
        column.isToday && 'ring-2 ring-(--tone-sky-solid)',
        isOver && props.accepting && 'bg-primary/5 ring-1 ring-primary/30',
      )}
    >
      <header className="border-b border-border px-2.5 py-2">
        <p className={cn('flex flex-wrap items-center gap-1.5 text-sm font-semibold', column.isPast && 'text-muted-foreground')}>
          {column.title}
          {column.isToday ? (
            <span className="rounded-full bg-(--tone-sky-solid) px-1.5 text-[10px] leading-4 font-bold text-white">Today</span>
          ) : null}
        </p>
        <p className="truncate text-xs text-muted-foreground">{tray ? `${column.jobs.length} to put on a day` : countLine(column.jobs)}</p>
        {column.date ? (
          <DayPeople date={column.date} jobs={column.jobs} colours={props.colours} canGiveOut={props.workers.length > 0} onAskGive={props.onAskGive} />
        ) : null}
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        <JobList
          from={column.key}
          date={column.date}
          jobs={column.jobs}
          lifted={props.lifted}
          gapIndex={props.gapIndex}
          gapHeight={props.gapHeight}
          colours={props.colours}
          workers={props.workers}
          moveOptions={props.moveOptions}
          canDrag={(job) => !props.locked && canMove(job)}
          groupLift={(jobs) => (props.locked ? [] : jobs.filter(canMove).map((job) => job.id))}
          emptyText={tray ? 'Drag a job here to take its date off' : column.isPast ? 'No jobs' : 'Free: drag a job here'}
          onMove={props.onMove}
          onAskGive={props.onAskGive}
        />
      </div>
    </section>
  );
}

/** Soft edge on the week scroller, shown only while days are cut off on that side (same as the Rounds board). */
function EdgeFade({ side, on }: { side: 'left' | 'right'; on: boolean }) {
  const left = side === 'left';
  return (
    <div
      aria-hidden
      // Below the "w/c" line, so a week's label is never blurred.
      className={cn('pointer-events-none absolute top-6 bottom-0 z-10 w-4 transition-opacity duration-200', left ? 'left-0' : 'right-0', on ? 'opacity-100' : 'opacity-0')}
    >
      <div
        className={cn(
          'absolute inset-0 backdrop-blur-sm',
          left
            ? '[mask-image:linear-gradient(to_right,black,transparent)] [-webkit-mask-image:linear-gradient(to_right,black,transparent)]'
            : '[mask-image:linear-gradient(to_left,black,transparent)] [-webkit-mask-image:linear-gradient(to_left,black,transparent)]',
        )}
      />
      <div className={cn('absolute inset-y-0 w-3 from-background to-transparent', left ? 'left-0 bg-gradient-to-r' : 'right-0 bg-gradient-to-l')} />
    </div>
  );
}

/**
 * The week board, laid out like the Rounds one: weeks side by side that scroll left and right (more load as you near
 * either end), a column per day with who is working it, the day's jobs in order and groups in their coloured box.
 * Drag a job (or a group by its handle) onto another day or into a new place. Saturday and Sunday show when they
 * have work. "No date yet" stays put on the right while the weeks scroll.
 */
export function ProWeekBoard(props: {
  date: Ymd;
  today: Ymd;
  jobs: ProCalendarJob[];
  undated: ProCalendarJob[];
  workers: CalendarWorker[];
  person: PersonFilter;
  /** The tags shown at the end of the board's controls. */
  extra?: ReactNode;
}) {
  const startRange = useMemo(() => initialRange(props.date), [props.date]);
  const pageWindow = useMemo(() => ({ from: startRange.from, to: rangeEnd(startRange) }), [startRange]);
  const incoming = useMemo(() => [...props.jobs, ...props.undated], [props.jobs, props.undated]);
  const { jobs, saving, place, give, merge } = useCalendarJobs(incoming, pageWindow);
  const router = useRouter();
  const [range, setRange] = useState<BoardRange>(startRange);
  const [trayOpen] = useStoredFlag(NO_DATE_KEY, false);
  const sensors = useCalendarSensors();
  const [drag, setDrag] = useState<CalendarDrag | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [gapHeight, setGapHeight] = useState(72);
  const [asking, setAsking] = useState<GiveRequest | null>(null);
  const [loadingEdge, setLoadingEdge] = useState<'earlier' | 'later' | null>(null);
  const [clipped, setClipped] = useState({ left: false, right: false });
  const colours = useMemo(() => workerColours(props.workers), [props.workers]);

  const scroller = useRef<HTMLDivElement>(null);
  const rangeRef = useRef(range);
  const loadingRef = useRef(false);
  const dragRef = useRef(false);
  /** The scroll position and width before weeks were added at the start, to keep the same day on screen. */
  const keep = useRef<{ left: number; width: number } | null>(null);
  const didInitialScroll = useRef(false);
  /** The week lined up on the left, kept as you scroll. */
  const viewWeek = useRef<Ymd | null>(mondayOf(props.date));

  useEffect(() => {
    rangeRef.current = range;
  }, [range]);

  const shown = filterJobs(jobs, props.person);
  const lifted = new Set(drag?.jobIds ?? []);

  const weeks = Array.from({ length: range.weeks }, (_, i) => {
    const monday = addDays(mondayOf(range.from), i * 7);
    const days = Array.from({ length: 7 }, (_, d) => addDays(monday, d)).filter(
      (day) => isoWeekday(day) <= 5 || shown.some((job) => job.date === day),
    );
    const columns: Column[] = days.map((day) => ({
      key: day,
      date: day,
      title: formatBoardDay(day),
      isToday: day === props.today,
      isPast: day < props.today,
      jobs: shown.filter((job) => job.date === day),
    }));
    const start = monday < props.today ? props.today : monday;
    return { monday, columns, moveOptions: moveOptionsFrom(start, props.today) };
  });
  const undated = shown.filter((job) => job.date === null);
  const tray: Column | null =
    trayOpen && undated.length > 0 ? { key: 'none', date: null, title: 'No date yet', isToday: false, isPast: false, jobs: undated } : null;
  const columns = [...weeks.flatMap((week) => week.columns), ...(tray ? [tray] : [])];
  const trayMoves = moveOptionsFrom(props.today, props.today);

  const accepts = (column: Column) => !column.isPast || drag?.from === column.key;

  // ---------- scrolling ----------

  const syncEdges = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const left = el.scrollLeft > 24;
    const right = el.scrollWidth - el.clientWidth - el.scrollLeft > 24;
    setClipped((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  const weekEl = (monday: Ymd) => scroller.current?.querySelector<HTMLElement>(`[data-week-start="${monday}"]`) ?? null;

  /** Bring a week to the left edge. */
  const scrollToWeek = useCallback((monday: Ymd, smooth = true) => {
    const el = scroller.current;
    const week = el?.querySelector<HTMLElement>(`[data-week-start="${monday}"]`);
    if (!el || !week) return false;
    el.scrollTo({ left: Math.max(0, week.offsetLeft - WEEK_GAP_PX), behavior: smooth ? 'smooth' : 'auto' });
    return true;
  }, []);

  // Open on the week asked for.
  useLayoutEffect(() => {
    if (didInitialScroll.current) return;
    const el = scroller.current;
    const week = el?.querySelector<HTMLElement>(`[data-week-start="${mondayOf(props.date)}"]`);
    if (el && week) {
      el.scrollLeft = Math.max(0, week.offsetLeft - WEEK_GAP_PX);
      didInitialScroll.current = true;
    }
    syncEdges();
  }, [props.date, syncEdges]);

  // Weeks added at the start push everything right: put the same day back where it was.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && keep.current) {
      el.scrollLeft = keep.current.left + (el.scrollWidth - keep.current.width);
      keep.current = null;
    }
    syncEdges();
  }, [range, syncEdges]);

  // When the window changes size the weeks change width: keep the week you were looking at lined up.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth !== width && viewWeek.current) scrollToWeek(viewWeek.current, false);
      width = el.clientWidth;
      syncEdges();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [syncEdges, scrollToWeek]);

  const loadMore = async (dir: 'earlier' | 'later') => {
    if (loadingRef.current || dragRef.current) return;
    loadingRef.current = true;
    setLoadingEdge(dir);
    try {
      const current = rangeRef.current;
      const next = extendRange(current, dir);
      const from = dir === 'earlier' ? next.from : addDays(rangeEnd(current), 1);
      const result = await loadProCalendarWeeks({ from, weeks: BOARD_LOAD_STEP_WEEKS });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      if (result.truncated) toast.message('Some jobs in those weeks are not shown. Use the Person filter to see fewer.');
      const el = scroller.current;
      if (el && next.from !== current.from) keep.current = { left: el.scrollLeft, width: el.scrollWidth };
      merge(result.jobs, result.from, result.to);
      setRange(next);
    } finally {
      loadingRef.current = false;
      setLoadingEdge(null);
    }
  };

  const onScroll = () => {
    syncEdges();
    const el = scroller.current;
    if (!el) return;
    viewWeek.current = weekInView();
    if (loadingRef.current) return;
    if (el.scrollLeft < EDGE_PX) void loadMore('earlier');
    else if (el.scrollWidth - (el.scrollLeft + el.clientWidth) < EDGE_PX) void loadMore('later');
  };

  /** The Monday of the week nearest the left edge. */
  const weekInView = (): Ymd => {
    const el = scroller.current;
    if (!el) return mondayOf(props.date);
    let best = weeks[0]!.monday;
    for (const week of weeks) {
      const node = weekEl(week.monday);
      if (node && node.offsetLeft <= el.scrollLeft + 40) best = week.monday;
    }
    return best;
  };

  const stepWeek = (delta: -1 | 1) => {
    const target = addDays(weekInView(), delta * 7);
    if (!scrollToWeek(target)) void loadMore(delta < 0 ? 'earlier' : 'later');
  };

  const thisWeek = mondayOf(props.today);
  const goToday = () => {
    if (!scrollToWeek(thisWeek)) router.push(calendarHref('week', props.today, props.person));
  };

  // ---------- dragging ----------

  const onDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as CalendarDrag | undefined;
    if (!data || saving) return;
    dragRef.current = true;
    setDrag(data);
    setGapHeight(Math.round(event.active.rect.current.initial?.height ?? 72));
    setHover(null);
  };

  const onDragOver = (event: DragOverEvent) => {
    setHover((current) => hoverFromEvent(event, current, lifted, gapHeight));
  };

  const finish = () => {
    dragRef.current = false;
    setDrag(null);
    setHover(null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const active = drag;
    const landed = hoverFromEvent(event, hover, lifted, gapHeight);
    finish();
    if (!active || !landed || active.jobIds.length === 0) return;
    const column = columns.find((c) => c.key === landed.key);
    if (!column || !accepts(column)) return;
    const target = column.date;
    const all = flattenDay(jobs.filter((job) => job.date === target)).map((job) => job.id);
    const visible = flattenDay(column.jobs).map((job) => job.id);
    const ordered = orderAfterFilteredDrop(all, visible, active.jobIds, landed.index);
    const moved = active.jobIds.filter((id) => jobs.find((job) => job.id === id)?.date !== target);
    if (moved.length === 0 && ordered.join('|') === all.join('|')) return;
    void place(target, ordered, moved);
  };

  const moveTo = (job: ProCalendarJob, date: Ymd | null) => {
    const all = flattenDay(jobs.filter((j) => j.date === date && j.id !== job.id)).map((j) => j.id);
    void place(date, [...all, job.id], [job.id]);
  };

  const column = (col: Column, moveOptions: ReadonlyArray<MoveOption>) => (
    <WeekColumn
      key={col.key}
      column={col}
      accepting={accepts(col)}
      lifted={lifted}
      gapIndex={hover?.key === col.key ? hover.index : null}
      gapHeight={gapHeight}
      colours={colours}
      workers={props.workers}
      moveOptions={moveOptions}
      locked={saving}
      onMove={moveTo}
      onAskGive={setAsking}
    />
  );

  return (
    <DndContext
      id="pro-week-dnd"
      sensors={sensors}
      collisionDetection={calendarCollision}
      autoScroll={{ layoutShiftCompensation: false }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={finish}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="icon" className="size-8" aria-label="Previous week" onClick={() => stepWeek(-1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button type="button" variant="outline" size="icon" className="size-8" aria-label="Next week" onClick={() => stepWeek(1)}>
            <ChevronRight className="size-4" />
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={goToday}>
            This week
          </Button>
          {saving ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Saving" /> : null}
        </div>
        {props.extra ? <div className="flex flex-wrap items-center gap-2">{props.extra}</div> : null}
      </div>

      <div className="flex gap-3">
        <div className="@container/board relative min-w-0 flex-1">
          <div ref={scroller} onScroll={onScroll} className="relative flex gap-4 overflow-x-auto overscroll-x-contain px-0.5 pt-0.5 pb-3">
            {weeks.map((week) => {
              const inWeek = week.columns.flatMap((c) => c.jobs);
              const totals = countJobs(inWeek);
              const noOne = totals.noOne + totals.declined;
              return (
                <div
                  key={week.monday}
                  data-week-start={week.monday}
                  className="w-max shrink-0 @min-[960px]/board:w-full @min-[960px]/board:min-w-0"
                >
                  <p className="mb-2 px-1 text-xs text-muted-foreground">
                    <span className={cn(week.monday === thisWeek && 'font-semibold text-foreground')}>
                      w/c {formatBoardDay(week.monday).replace(/^\w+ /, '')}
                      {week.monday === thisWeek ? ' · This week' : ''}
                    </span>
                    {' · '}
                    {totals.total} {totals.total === 1 ? 'job' : 'jobs'}
                    {totals.done > 0 ? ` · ${totals.done} done` : ''}
                    {noOne > 0 ? <span className={toneClasses('amber').text}> · {noOne} with no one</span> : null}
                  </p>
                  <div className="flex gap-2 @min-[960px]/board:w-full @min-[960px]/board:min-w-0">
                    {week.columns.map((col) => column(col, week.moveOptions))}
                  </div>
                </div>
              );
            })}
          </div>
          {loadingEdge ? (
            <div className={cn('pointer-events-none absolute top-1/2 z-20', loadingEdge === 'earlier' ? 'left-2' : 'right-2')}>
              <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading more weeks" />
            </div>
          ) : null}
          <EdgeFade side="left" on={clipped.left} />
          <EdgeFade side="right" on={clipped.right} />
        </div>
        {tray ? <div className="shrink-0 pt-6">{column(tray, trayMoves)}</div> : null}
      </div>

      <DragOverlay dropAnimation={null}>
        {drag ? (
          <div style={{ width: drag.kind === 'job' ? 200 : undefined }}>
            <DragCopy drag={drag} jobs={jobs} colours={colours} />
          </div>
        ) : null}
      </DragOverlay>
      <GivePicker
        request={asking}
        workers={props.workers}
        jobs={jobs}
        colours={colours}
        onClose={() => setAsking(null)}
        onGive={(ids, worker) => void give(ids, worker)}
      />
    </DndContext>
  );
}
