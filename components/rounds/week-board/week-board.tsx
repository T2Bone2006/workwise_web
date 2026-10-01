'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from 'react';
import { DndContext } from '@dnd-kit/core';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  moveStopToDay,
  reorderDay,
  swapDays,
  tellCustomersAboutChange,
  undoVisitChange,
} from '@/lib/actions/rounds/visits';
import { loadBoardWeeks, loadUntoldMoves } from '@/lib/actions/rounds/board';
import type { VisitRow } from '@/lib/data/rounds/visits';
import { dayMovedSms, type SmsBrand } from '@/lib/messaging/templates';
import { formatVisitDay } from '@/lib/payments/messages';
import { addDays, type Ymd } from '@/lib/rounds/dates';
import type { UntoldMove } from '@/lib/rounds/visit-changes';
import {
  BOARD_LOAD_STEP_WEEKS,
  applyLocalMove,
  buildWeeks,
  extendRange,
  findHouseMatch,
  formatBoardDay,
  jobAsStop,
  mondayOf,
  orderAfterDrop,
  rangeEnd,
  untoldByJob,
  type BoardDay,
  type BoardRange,
  type BoardStop,
} from '@/lib/rounds/week-board';
import { ChangePreview } from '@/components/messaging/change-preview';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatGbp } from '@/lib/money/pence';
import { BoardDayColumn, type ColumnHighlight } from './board-day-column';
import { BoardDragOverlay } from './board-drag-overlay';
import { useBoardDnd, type DndActive, type DndTarget } from './use-board-dnd';
import { BoardStopPanel } from './board-stop-panel';
import { BoardToast, type BoardToastData } from './board-toast';
import { MoveStopDialog, toldText, type BoardChangeResult } from './move-stop-dialog';
import { SwapDaysDialog } from './swap-days-dialog';

const FLASH_MS = 3000;
/** How close (px) to either end of the board before the next weeks are loaded. */
const EDGE_PX = 400;
/** Most weeks one request may ask for. */
const CHUNK_WEEKS = BOARD_LOAD_STEP_WEEKS * 2;

type TellRequest = { changeId: string; fromDate: Ymd | null; toDate: Ymd | null };

/** Replace the visits that fall on or between `from` and `to` with the freshly loaded ones. */
function mergeVisits(prev: VisitRow[], fetched: VisitRow[], from: Ymd, to: Ymd): VisitRow[] {
  const kept = prev.filter((v) => !v.scheduled_date || v.scheduled_date < from || v.scheduled_date > to);
  return [...kept, ...fetched];
}

/** Load a run of weeks, a few at a time. */
async function fetchWeeks(
  from: Ymd,
  weeks: number,
): Promise<{ ok: true; visits: VisitRow[] } | { ok: false; error: string }> {
  const parts: Promise<Awaited<ReturnType<typeof loadBoardWeeks>>>[] = [];
  for (let done = 0; done < weeks; done += CHUNK_WEEKS) {
    parts.push(
      loadBoardWeeks({ from: addDays(from, done * 7), weeks: Math.min(CHUNK_WEEKS, weeks - done) }),
    );
  }
  const results = await Promise.all(parts);
  const visits: VisitRow[] = [];
  for (const result of results) {
    if (!result.success) return { ok: false, error: result.error };
    visits.push(...result.visits);
  }
  return { ok: true, visits };
}

/** The Week view: days side by side, a gap between weeks, scrolling left and right. */
export function WeekBoard(props: {
  initialVisits: VisitRow[];
  initialRange: BoardRange;
  today: Ymd;
  workingDays: number[];
  blackouts: string[];
  brand: SmsBrand;
  initialUntold: UntoldMove[];
}): JSX.Element {
  const { today, brand } = props;
  const [visits, setVisits] = useState(props.initialVisits);
  const [range, setRange] = useState(props.initialRange);
  const [untold, setUntold] = useState(props.initialUntold);
  const [message, setMessage] = useState<BoardToastData | null>(null);
  const [tell, setTell] = useState<TellRequest | null>(null);
  const [tellBusy, setTellBusy] = useState(false);
  const [flashIds, setFlashIds] = useState<ReadonlySet<string>>(new Set());
  /** The visits as they will be once a drop is saved, so the card stays where it landed. */
  const [optimistic, setOptimistic] = useState<VisitRow[] | null>(null);
  const [busyStopId, setBusyStopId] = useState<string | null>(null);
  const shownVisits = optimistic ?? visits;
  const [loadingEdge, setLoadingEdge] = useState<'earlier' | 'later' | null>(null);

  const [panel, setPanel] = useState<{ stopId: string; date: Ymd } | null>(null);
  const [moving, setMoving] = useState<{ stopId: string; date: Ymd; jobId?: string } | null>(null);
  const [swapping, setSwapping] = useState<Ymd | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const loadingRef = useRef(false);
  /** The scroll position and width before the weeks changed, to put the same column back under the mouse. */
  const keep = useRef<{ left: number; width: number } | null>(null);
  /** The weeks changed at the start (added or dropped), so the scroll position has to move with them. */
  const rangeStartMoved = useRef(false);
  const pendingReveal = useRef<Ymd | null>(null);
  const didInitialScroll = useRef(false);

  const untoldMap = useMemo(() => untoldByJob(untold, shownVisits, today), [untold, shownVisits, today]);
  const weeks = useMemo(
    () =>
      buildWeeks({
        visits: shownVisits,
        from: range.from,
        weeks: range.weeks,
        today,
        workingDays: props.workingDays,
        blackouts: props.blackouts,
        untold: untoldMap,
      }),
    [shownVisits, range, today, props.workingDays, props.blackouts, untoldMap],
  );

  // The page re-reads its first weeks after an action in the side panel: fold them in.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setVisits((prev) =>
      mergeVisits(prev, props.initialVisits, props.initialRange.from, rangeEnd(props.initialRange)),
    );
    setUntold(props.initialUntold);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.initialVisits, props.initialUntold]);

  const findDay = useCallback(
    (date: Ymd): BoardDay | null => {
      for (const week of weeks) {
        const found = week.days.find((d) => d.date === date);
        if (found) return found;
      }
      return null;
    },
    [weeks],
  );

  /** The board's version of any day, even outside the weeks on screen. */
  const resolveDay = useCallback(
    (date: Ymd): BoardDay => {
      const found = findDay(date);
      if (found) return found;
      const [week] = buildWeeks({
        visits: shownVisits,
        from: date,
        weeks: 1,
        today,
        workingDays: props.workingDays,
        blackouts: props.blackouts,
        untold: untoldMap,
      });
      return week!.days.find((d) => d.date === date)!;
    },
    [findDay, shownVisits, today, props.workingDays, props.blackouts, untoldMap],
  );

  const findStop = (ref: { stopId: string; date: Ymd } | null): BoardStop | null =>
    ref ? (findDay(ref.date)?.stops.find((s) => s.id === ref.stopId) ?? null) : null;
  const panelStop = findStop(panel);
  // "Move just this job…" moves one job of a combined card as a stop of its own.
  const movingParent = findStop(moving);
  const movingStop =
    movingParent && moving?.jobId ? jobAsStop(movingParent, moving.jobId) : movingParent;
  const swappingDay = swapping ? findDay(swapping) : null;

  // ---------- the floating message ----------

  const seq = useRef(0);
  const say = useCallback(
    (text: string, opts?: Partial<Pick<BoardToastData, 'tone' | 'actions' | 'sticky' | 'durationMs'>>) => {
      seq.current += 1;
      setMessage({ id: String(seq.current), text, ...opts });
    },
    [],
  );

  /** Reload everything on the board (and the "Not told" list) after a change. */
  const refresh = useCallback(async () => {
    const current = rangeRef.current;
    const [loaded, moves] = await Promise.all([
      fetchWeeks(current.from, current.weeks),
      loadUntoldMoves(),
    ]);
    if (loaded.ok) {
      setVisits((prev) => mergeVisits(prev, loaded.visits, current.from, rangeEnd(current)));
    } else {
      toast.error(loaded.error);
    }
    setUntold(moves);
  }, []);

  const flash = useCallback((jobIds: string[]) => {
    if (jobIds.length === 0) return;
    const ids = new Set(jobIds);
    setFlashIds(ids);
    setTimeout(() => setFlashIds((current) => (current === ids ? new Set() : current)), FLASH_MS);
  }, []);

  const scrollToDay = useCallback((date: Ymd) => {
    const el = scroller.current;
    const column = el?.querySelector<HTMLElement>(`[data-date="${date}"]`);
    if (!el || !column) return;
    const left = column.offsetLeft;
    const visible = left >= el.scrollLeft && left + column.offsetWidth <= el.scrollLeft + el.clientWidth;
    if (!visible) el.scrollTo({ left: Math.max(0, left - 48), behavior: 'smooth' });
  }, []);

  /** Bring a day into view, loading the weeks around it first if it is further away than the board reaches. */
  const revealDay = useCallback(
    async (date: Ymd) => {
      const current = rangeRef.current;
      if (date >= current.from && date <= rangeEnd(current)) {
        scrollToDay(date);
        return;
      }
      const next = { from: addDays(mondayOf(date), -14), weeks: 6 };
      const loaded = await fetchWeeks(next.from, next.weeks);
      if (!loaded.ok) {
        toast.error(loaded.error);
        return;
      }
      pendingReveal.current = date;
      setVisits(loaded.visits);
      setRange(next);
    },
    [scrollToDay],
  );

  const afterChange = useCallback(
    async (jobIds: string[], revealDate: Ymd | null) => {
      await refresh();
      if (revealDate) await revealDay(revealDate);
      flash(jobIds);
    },
    [flash, refresh, revealDay],
  );

  const undoChange = useCallback(
    async (changeId: string) => {
      say('Putting it back…', { tone: 'working', sticky: true });
      const result = await undoVisitChange({ changeId, notifyCustomers: false });
      if (!result.success) {
        say(result.error, { tone: 'danger' });
        return;
      }
      say(
        result.leftAlone > 0
          ? `Put back ${result.restored} · ${result.leftAlone} already done, left as it is`
          : `Put back ${result.restored}`,
        { durationMs: 4000 },
      );
      await refresh();
    },
    [refresh, say],
  );

  /** "Moved Mrs Jones to Thu 8 Oct" with Tell them and Undo, for the next 10 seconds. */
  const announce = useCallback(
    (a: Pick<BoardChangeResult, 'text' | 'changeId' | 'fromDate' | 'toDate' | 'told'>) => {
      const actions: NonNullable<BoardToastData['actions']> = [];
      const changeId = a.changeId;
      if (changeId && !a.told) {
        actions.push({
          label: 'Tell them',
          onClick: () => setTell({ changeId, fromDate: a.fromDate, toDate: a.toDate }),
        });
      }
      if (changeId) actions.push({ label: 'Undo', onClick: () => void undoChange(changeId) });
      say(a.text, { actions });
    },
    [say, undoChange],
  );

  const sendTell = async () => {
    if (!tell) return;
    setTellBusy(true);
    const result = await tellCustomersAboutChange({ changeId: tell.changeId });
    setTellBusy(false);
    setTell(null);
    if (!result.success) {
      say(result.error, { tone: 'danger' });
    } else {
      say(toldText(result.notified, result.alreadyTold), { durationMs: 4000 });
    }
    await refresh();
  };

  const finished = (result: BoardChangeResult | null) => {
    setMoving(null);
    setSwapping(null);
    if (!result) {
      void refresh();
      return;
    }
    announce(result);
    void afterChange(result.jobIds, result.revealDate);
  };

  const untoldInfo = (changeId: string): TellRequest => {
    const move = untold.find((m) => m.changeId === changeId);
    return { changeId, fromDate: move?.fromDate ?? null, toDate: move?.toDate ?? null };
  };


  // ---------- dropping ----------

  const jobsRef = useRef(shownVisits);
  jobsRef.current = shownVisits;
  /** Counts drops, so an older refresh can't clear a newer drop's optimistic state. */
  const dropSeq = useRef(0);

  /** A card was let go over a day: save the move or the new order. */
  const dropCard = async (active: Extract<DndActive, { kind: 'card' }>, over: DndTarget) => {
    // Let go outside the board, over a past day, or nowhere: it springs back, nothing is sent.
    if (!over || !over.valid) return;
    const day = resolveDay(over.date);
    const sameDay = over.date === active.fromDate;
    const joins = !sameDay && over.mergeStopId ? (day.stops.find((s) => s.id === over.mergeStopId) ?? null) : null;
    const order = orderAfterDrop({
      target: day,
      dragged: active.stop,
      index: over.index,
      mergeInto: findHouseMatch(day, active.stop) ?? undefined,
    });
    const current = day.stops.flatMap((s) => s.jobIds);
    if (sameDay && order.length === current.length && order.every((id, i) => id === current[i])) return;

    // Only the save itself locks the board. Re-reading the weeks afterwards happens in the background,
    // so you can lift the card again straight away (and a newer drop is never wiped by an older refresh).
    dropSeq.current += 1;
    const mine = dropSeq.current;
    const clearOptimistic = () => {
      if (dropSeq.current === mine) setOptimistic(null);
    };
    setBusyStopId(active.stop.id);
    setOptimistic(
      applyLocalMove(jobsRef.current, {
        jobIds: sameDay ? [] : active.stop.jobIds,
        toDate: over.date,
        orderedJobIds: order,
      }),
    );

    if (sameDay) {
      let result: Awaited<ReturnType<typeof reorderDay>>;
      try {
        result = await reorderDay({ date: over.date, jobIds: order });
      } finally {
        setBusyStopId(null);
      }
      if (!result.success) {
        clearOptimistic();
        say(result.error, { tone: 'danger' });
        void refresh();
        return;
      }
      await refresh();
      clearOptimistic();
      return;
    }

    let result: Awaited<ReturnType<typeof moveStopToDay>>;
    try {
      result = await moveStopToDay({
        jobIds: active.stop.jobIds,
        toDate: over.date,
        orderedJobIds: order,
      });
    } finally {
      setBusyStopId(null);
    }
    if (!result.success) {
      clearOptimistic();
      say(result.error, { tone: 'danger' });
      void refresh();
      return;
    }
    let text = joins
      ? `Added to ${active.stop.name}'s visit on ${formatBoardDay(over.date)}`
      : `Moved ${active.stop.name} to ${formatBoardDay(over.date)}`;
    if (!result.orderSaved) text += ' · not in place, drag it again';
    announce({
      text,
      changeId: result.changeId,
      fromDate: active.fromDate,
      toDate: over.date,
      told: false,
    });
    await afterChange(active.stop.jobIds, null);
    clearOptimistic();
  };

  /** A day was let go over another day: swap them now. Undo is one tap away and nobody is texted. */
  const dropDay = async (active: Extract<DndActive, { kind: 'day' }>, over: DndTarget) => {
    if (!over || !over.valid) return;
    const a = active.day.date;
    const b = over.date;
    const movedIds = [...active.day.stops, ...resolveDay(b).stops]
      .filter((stop) => stop.movable)
      .flatMap((stop) => stop.jobIds);
    say(`Swapping ${formatBoardDay(a)} and ${formatBoardDay(b)}…`, { tone: 'working', sticky: true });
    const result = await swapDays({
      dayA: a,
      dayB: b,
      clientKey: crypto.randomUUID(),
      notifyCustomers: false,
    });
    if (!result.success) {
      const changeId = result.changeId;
      say(result.error, {
        tone: 'danger',
        actions: changeId ? [{ label: 'Undo', onClick: () => void undoChange(changeId) }] : undefined,
      });
      void refresh();
      return;
    }
    announce({
      text: `Swapped ${formatBoardDay(a)} and ${formatBoardDay(b)}`,
      changeId: result.changeId,
      fromDate: a,
      toDate: b,
      told: false,
    });
    await afterChange(movedIds, null);
  };

  const dnd = useBoardDnd({
    weeks,
    busy: busyStopId !== null,
    scroller,
    onDropCard: (a, t) => void dropCard(a, t),
    onDropDay: (a, t) => void dropDay(a, t),
  });
  const dragging = dnd.active;
  const over = dnd.target;
  const locked = busyStopId !== null || dnd.landing;

  function columnState(day: BoardDay): {
    liftedStopId: string | null;
    liftedJobId: string | null;
    gapIndex: number | null;
    originIndex: number | null;
    joinStopId: string | null;
    highlight: ColumnHighlight;
  } {
    const none = { liftedStopId: null, liftedJobId: null, gapIndex: null, originIndex: null, joinStopId: null, highlight: null };
    if (!dragging) return none;
    if (dragging.kind === 'day') {
      if (dragging.day.date === day.date) return { ...none, highlight: 'swap-source' };
      return { ...none, highlight: over?.date === day.date && over.valid ? 'swap' : null };
    }
    const fromHere = dragging.fromDate === day.date;
    const here = over?.date === day.date;
    const joins = here && over?.valid ? over.mergeStopId : null;
    return {
      liftedStopId: fromHere && !dragging.single ? dragging.stop.id : null,
      liftedJobId: fromHere && dragging.single ? dragging.single.jobId : null,
      gapIndex: here && over?.valid && !over.mergeStopId ? over.index : null,
      // Where it came from, shown while it isn't over a valid place (so it can glide back).
      originIndex: fromHere && !dragging.single && !(over?.valid) ? day.stops.findIndex((s) => s.id === dragging.stop.id) : null,
      joinStopId: joins,
      highlight: here ? (over?.valid ? 'drop' : 'denied') : null,
    };
  }

  const joinName =
    dragging?.kind === 'card' && over?.valid && over.mergeStopId ? dragging.stop.name : null;

  // ---------- scrolling ----------

  // Open on this week's Monday.
  useLayoutEffect(() => {
    if (didInitialScroll.current) return;
    const el = scroller.current;
    const week = el?.querySelector<HTMLElement>(`[data-week-start="${mondayOf(today)}"]`);
    if (el && week) {
      el.scrollLeft = week.offsetLeft - 8;
      didInitialScroll.current = true;
    }
  }, [today, weeks]);

  // After the weeks change: keep the same column where it was, or bring a far-away day into view.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (keep.current) {
      el.scrollLeft = keep.current.left + (el.scrollWidth - keep.current.width) * (rangeStartMoved.current ? 1 : 0);
      keep.current = null;
      rangeStartMoved.current = false;
    }
    if (pendingReveal.current) {
      const date = pendingReveal.current;
      pendingReveal.current = null;
      scrollToDay(date);
    }
  }, [range, scrollToDay]);
  const loadMore = useCallback(
    async (dir: 'earlier' | 'later') => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoadingEdge(dir);
      try {
        const current = rangeRef.current;
        const next = extendRange(current, dir);
        const fromDate = dir === 'earlier' ? next.from : addDays(rangeEnd(current), 1);
        const loaded = await fetchWeeks(fromDate, BOARD_LOAD_STEP_WEEKS);
        if (!loaded.ok) {
          toast.error(loaded.error);
          return;
        }
        const el = scroller.current;
        if (el) keep.current = { left: el.scrollLeft, width: el.scrollWidth };
        // Weeks added before, or dropped from the start, move everything: keep the column in place.
        rangeStartMoved.current = next.from !== current.from;
        setVisits((prev) => mergeVisits(prev, loaded.visits, fromDate, rangeEnd({ from: fromDate, weeks: BOARD_LOAD_STEP_WEEKS })));
        setRange(next);
      } finally {
        loadingRef.current = false;
        setLoadingEdge(null);
      }
    },
    [],
  );

  const onScroll = () => {
    const el = scroller.current;
    if (!el || loadingRef.current) return;
    if (el.scrollLeft < EDGE_PX) void loadMore('earlier');
    else if (el.scrollWidth - (el.scrollLeft + el.clientWidth) < EDGE_PX) void loadMore('later');
  };

  return (
    <>
      <DndContext
        // A fixed id keeps the server and browser HTML the same (dnd-kit otherwise counts up its own).
        id="week-board-dnd"
        sensors={dnd.sensors}
        accessibility={{ announcements: dnd.announcements }}
        autoScroll={false}
        {...dnd.handlers}
      >
      <div className="relative">
        <div
          ref={scroller}
          onScroll={onScroll}
          className="relative flex gap-6 overflow-x-auto overscroll-x-contain pb-3"
        >
          {weeks.map((week) => (
            <div key={week.weekStart} data-week-start={week.weekStart} className="shrink-0">
              <p className="mb-2 px-1 text-xs text-muted-foreground">
                {week.label} · {week.stops} {week.stops === 1 ? 'stop' : 'stops'} ·{' '}
                {formatGbp(week.amount)}
              </p>
              <div className="flex gap-2">
                {week.days.map((day) => (
                  <BoardDayColumn
                    key={day.date}
                    day={day}
                    flashIds={flashIds}
                    locked={locked}
                    gapHeight={dragging?.kind === 'card' ? dragging.height : 0}
                    {...columnState(day)}
                    onOpen={(stop, date) => setPanel({ stopId: stop.id, date })}
                    onMove={(stop, date) => setMoving({ stopId: stop.id, date })}
                    onMoveJob={(stop, date, jobId) => setMoving({ stopId: stop.id, date, jobId })}
                    onTell={(changeId) => setTell(untoldInfo(changeId))}
                    onSwap={(d) => setSwapping(d.date)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        {loadingEdge ? (
          <div
            className={
              loadingEdge === 'earlier'
                ? 'pointer-events-none absolute left-2 top-1/2'
                : 'pointer-events-none absolute right-2 top-1/2'
            }
          >
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading more weeks" />
          </div>
        ) : null}
      </div>

      <BoardDragOverlay
        active={dragging}
        target={over}
        joinName={joinName}
        attach={dnd.setOverlay}
      />
      </DndContext>

      <BoardStopPanel stop={panelStop} brand={brand} onOpenChange={(open) => !open && setPanel(null)} />

      <MoveStopDialog
        stop={movingStop}
        fromDate={moving?.date ?? today}
        today={today}
        brand={brand}
        open={moving !== null && movingStop !== null}
        resolveDay={resolveDay}
        onOpenChange={(open) => !open && setMoving(null)}
        onFinished={finished}
      />
      <SwapDaysDialog
        day={swappingDay}
        today={today}
        brand={brand}
        open={swapping !== null && swappingDay !== null}
        resolveDay={resolveDay}
        onOpenChange={(open) => !open && setSwapping(null)}
        onFinished={finished}
      />

      <Dialog open={tell !== null} onOpenChange={(open) => !open && !tellBusy && setTell(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tell the customers?</DialogTitle>
          </DialogHeader>
          {tell?.toDate ? (
            <ChangePreview
              text={dayMovedSms({
                brand,
                fromDay: tell.fromDate ? formatVisitDay(tell.fromDate) : formatVisitDay(tell.toDate),
                toDay: formatVisitDay(tell.toDate),
              })}
            />
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setTell(null)} disabled={tellBusy}>
              Cancel
            </Button>
            <Button onClick={() => void sendTell()} disabled={tellBusy}>
              {tellBusy ? <Loader2 className="size-4 animate-spin" /> : null}
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BoardToast
        message={message}
        paused={tell !== null || moving !== null || swapping !== null}
        onDismiss={(id) => setMessage((current) => (current?.id === id ? null : current))}
      />
    </>
  );
}
