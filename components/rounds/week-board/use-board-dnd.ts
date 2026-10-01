'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  KeyboardSensor,
  type Announcements,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type { Ymd } from '@/lib/rounds/dates';
import {
  canDropOn,
  canSwap,
  dropIndex,
  findHouseMatch,
  jobAsStop,
  type BoardDay,
  type BoardStop,
  type BoardWeek,
} from '@/lib/rounds/week-board';

export type DndActive =
  | {
      kind: 'card';
      /** For a single job taken out of a combined card this is the job as a stop of its own. */
      stop: BoardStop;
      fromDate: Ymd;
      width: number;
      height: number;
      /** Set when only one job of a combined card is being moved: the card it came from stays put. */
      single: { stopId: string; jobId: string } | null;
    }
  | { kind: 'day'; day: BoardDay };

/**
 * Where a drop would land. For a card, `index` is the spot among that day's other stops
 * (the dragged one taken out); for a day, `valid` means "can swap with it".
 */
export type DndTarget = {
  date: Ymd;
  valid: boolean;
  index: number;
  /** The stop there that is the same house: dropping joins it (no gap opens). */
  mergeStopId: string | null;
} | null;

/** How long a dropped card takes to travel into its place (0 = it just lands). */
export const GLIDE_MS = 180;
/** How close (px) to an edge before the board or a column scrolls itself. */
const EDGE_PX = 64;
const MAX_SPEED = 14;

/** The card or grip that was pressed to start this drag. */
function pressedElement(event: DragStartEvent): Element | null {
  const target = event.activatorEvent?.target;
  if (!(target instanceof Element)) return null;
  // A job row, else the main part of a card (not its opened-out jobs), else a day grip.
  return (
    target.closest('[data-job-id]') ??
    target.closest('[data-stop-main]') ??
    target.closest('[aria-roledescription^="draggable"]')
  );
}

function edgeSpeed(distance: number): number {
  if (distance >= EDGE_PX) return 0;
  return MAX_SPEED * (1 - Math.max(0, distance) / EDGE_PX);
}

function sameTarget(a: DndTarget, b: DndTarget): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.date === b.date && a.valid === b.valid && a.index === b.index && a.mergeStopId === b.mergeStopId;
}

type Params = {
  weeks: BoardWeek[];
  /** A move is being saved, or a drop is still landing: nothing else can be picked up. */
  busy: boolean;
  scroller: RefObject<HTMLDivElement | null>;
  onDropCard: (active: Extract<DndActive, { kind: 'card' }>, target: DndTarget) => void;
  onDropDay: (active: Extract<DndActive, { kind: 'day' }>, target: DndTarget) => void;
};

/**
 * Drag and drop for the Week board. dnd-kit handles the mouse, touch and keyboard;
 * which day and which spot a card would land in is worked out here from where the card
 * is on the screen, the same way the phone does it. The floating copy is moved directly
 * (no re-render per move), and React is only told when the target changes.
 */
export function useBoardDnd(params: Params) {
  const latest = useRef(params);
  // Keep the newest props where the handlers can read them (they run later, from events).
  useEffect(() => {
    latest.current = params;
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    // Space lifts and drops, Enter stays free for opening the card menu.
    useSensor(KeyboardSensor, {
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  );

  const [active, setActive] = useState<DndActive | null>(null);
  const [target, setTargetState] = useState<DndTarget>(null);
  /** The dropped card is travelling to its place. */
  const [landing, setLanding] = useState(false);

  const activeRef = useRef<DndActive | null>(null);
  const targetRef = useRef<DndTarget>(null);
  const overlay = useRef<HTMLDivElement | null>(null);
  const center = useRef({ x: 0, y: 0 });
  /** Where the lifted card started on screen. The copy follows this plus how far the pointer has moved, so hiding the original can't throw it off. */
  const start = useRef({ left: 0, top: 0, width: 0, height: 0 });
  const frame = useRef<number | null>(null);

  const setTarget = useCallback((next: DndTarget) => {
    if (sameTarget(targetRef.current, next)) return;
    targetRef.current = next;
    setTargetState(next);
  }, []);

  const dayAt = useCallback((date: Ymd): BoardDay | null => {
    for (const week of latest.current.weeks) {
      const found = week.days.find((d) => d.date === date);
      if (found) return found;
    }
    return null;
  }, []);

  /** Work out the target from the centre of the floating copy. */
  const updateTarget = useCallback(() => {
    const current = activeRef.current;
    if (!current) return;
    const { x, y } = center.current;

    const scrollerEl = latest.current.scroller.current;
    const bounds = scrollerEl?.getBoundingClientRect();
    if (bounds && (y < bounds.top || y > bounds.bottom || x < bounds.left || x > bounds.right)) {
      setTarget(null);
      return;
    }

    const column = document
      .elementsFromPoint(x, y)
      .map((el) => el.closest<HTMLElement>('[data-date]'))
      .find((el): el is HTMLElement => el !== null);
    const date = column?.dataset.date;
    // Between two columns (the gap between weeks): keep the last target.
    if (!column || !date) return;
    const day = dayAt(date);
    if (!day) return;

    if (current.kind === 'day') {
      setTarget({ date, valid: canSwap(current.day, day), index: 0, mergeStopId: null });
      return;
    }
    if (!canDropOn(day)) {
      setTarget({ date, valid: false, index: 0, mergeStopId: null });
      return;
    }
    // One job back onto its own day would only join its own card again: nowhere to drop.
    if (current.single && current.fromDate === date) {
      setTarget(null);
      return;
    }
    const others = day.stops.filter((stop) => stop.id !== current.stop.id);
    // The same house is already on this day: dropping anywhere on it joins that visit.
    const match = current.fromDate === date ? null : findHouseMatch(day, current.stop);
    if (match) {
      setTarget({ date, valid: true, index: others.findIndex((s) => s.id === match.id), mergeStopId: match.id });
      return;
    }
    const mids = Array.from(column.querySelectorAll<HTMLElement>('[data-stop-id]'))
      .filter((el) => el.dataset.stopId !== current.stop.id)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return rect.top + rect.height / 2;
      });
    const activeCount = others.filter((stop) => stop.state !== 'skipped').length;
    const index = Math.min(dropIndex(mids, y), activeCount);
    setTarget({ date, valid: true, index, mergeStopId: null });
  }, [dayAt, setTarget]);

  const stopLoop = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  // The loop calls itself through a ref, so it is always the latest version.
  const tickRef = useRef<() => void>(() => {});

  /** Scroll the board sideways, and the column under the card up or down, when the card is near an edge. */
  const tick = useCallback(() => {
    if (!activeRef.current) {
      frame.current = null;
      return;
    }
    const { x, y } = center.current;
    let moved = false;

    const scrollerEl = latest.current.scroller.current;
    if (scrollerEl) {
      const bounds = scrollerEl.getBoundingClientRect();
      const dx = edgeSpeed(bounds.right - x) - edgeSpeed(x - bounds.left);
      if (dx !== 0) {
        const before = scrollerEl.scrollLeft;
        scrollerEl.scrollLeft = before + dx;
        if (scrollerEl.scrollLeft !== before) moved = true;
      }
    }

    const over = targetRef.current;
    if (over && activeRef.current.kind === 'card') {
      const area = document.querySelector<HTMLElement>(`[data-date="${over.date}"] [data-col-scroll]`);
      if (area) {
        const bounds = area.getBoundingClientRect();
        const dy = edgeSpeed(bounds.bottom - y) - edgeSpeed(y - bounds.top);
        if (dy !== 0) {
          const before = area.scrollTop;
          area.scrollTop = before + dy;
          if (area.scrollTop !== before) moved = true;
        }
      }
    }

    if (moved) updateTarget();
    frame.current = requestAnimationFrame(() => tickRef.current());
  }, [updateTarget]);

  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  useEffect(() => stopLoop, [stopLoop]);

  const place = useCallback((left: number, top: number, scale: number) => {
    const el = overlay.current;
    if (el) el.style.transform = `translate3d(${left}px, ${top}px, 0) scale(${scale})`;
  }, []);

  const onDragStart = useCallback(
    (event: DragStartEvent) => {
      if (latest.current.busy) return;
      const id = String(event.active.id);
      // dnd-kit hasn't measured the card yet when a drag starts, so read it from the page.
      const measured = event.active.rect.current.initial ?? pressedElement(event)?.getBoundingClientRect() ?? null;
      const rect = measured ? { left: measured.left, top: measured.top, width: measured.width, height: measured.height } : null;
      let next: DndActive | null = null;
      if (id.startsWith('stop:')) {
        const date = event.active.data.current?.date as Ymd | undefined;
        const day = date ? dayAt(date) : null;
        const stop = day?.stops.find((s) => s.id === id.slice(5));
        if (day && stop && stop.movable && rect) {
          next = { kind: 'card', stop, fromDate: day.date, width: rect.width, height: rect.height, single: null };
        }
      } else if (id.startsWith('job:')) {
        const date = event.active.data.current?.date as Ymd | undefined;
        const stopId = event.active.data.current?.stopId as string | undefined;
        const day = date ? dayAt(date) : null;
        const parent = day?.stops.find((s) => s.id === stopId);
        const single = parent ? jobAsStop(parent, id.slice(4)) : null;
        if (day && parent && single && single.movable && rect) {
          next = {
            kind: 'card',
            stop: single,
            fromDate: day.date,
            width: rect.width,
            height: rect.height,
            single: { stopId: parent.id, jobId: single.id },
          };
        }
      } else if (id.startsWith('dayhead:')) {
        const day = dayAt(id.slice(8));
        if (day && !day.isPast && day.stops.some((s) => s.movable)) next = { kind: 'day', day };
      }
      if (!next) return;
      activeRef.current = next;
      setActive(next);
      if (rect) {
        start.current = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
        center.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        place(rect.left, rect.top, 1.03);
      }
      updateTarget();
      stopLoop();
      frame.current = requestAnimationFrame(() => tickRef.current());
    },
    [dayAt, place, stopLoop, updateTarget],
  );

  const onDragMove = useCallback(
    (event: DragMoveEvent) => {
      if (!activeRef.current) return;
      const { left, top, width, height } = start.current;
      const x = left + event.delta.x;
      const y = top + event.delta.y;
      center.current = { x: x + width / 2, y: y + height / 2 };
      place(x, y, 1.03);
      updateTarget();
    },
    [place, updateTarget],
  );

  const finish = useCallback(() => {
    stopLoop();
    activeRef.current = null;
    targetRef.current = null;
    setActive(null);
    setTargetState(null);
    setLanding(false);
  }, [stopLoop]);

  const onDragEnd = useCallback(
    () => {
      const current = activeRef.current;
      const over = targetRef.current;
      if (!current) return;
      stopLoop();

      if (current.kind === 'day') {
        finish();
        latest.current.onDropDay(current, over);
        return;
      }

      // A card: glide it into the gap (or back to where it came from), then land it.
      const valid = over !== null && over.valid;
      const destination = valid
        ? over.mergeStopId
          ? document.querySelector<HTMLElement>(`[data-stop-id="${over.mergeStopId}"]`)
          : document.querySelector<HTMLElement>('[data-board-placeholder="gap"]')
        : current.single
          ? document.querySelector<HTMLElement>(`[data-job-id="${current.single.jobId}"]`)
          : document.querySelector<HTMLElement>('[data-board-placeholder="origin"]');
      const to = destination?.getBoundingClientRect();
      const land = () => {
        finish();
        latest.current.onDropCard(current, over);
      };
      if (to && to.width > 0 && GLIDE_MS > 0) {
        setLanding(true);
        const el = overlay.current;
        if (el) {
          el.style.transition = `transform ${GLIDE_MS}ms ease-out`;
          place(to.left, to.top, 1);
        }
        setTimeout(land, GLIDE_MS + 20);
      } else {
        land();
      }
    },
    [finish, place, stopLoop],
  );

  const onDragCancel = useCallback(() => {
    finish();
  }, [finish]);

  const announcements: Announcements = {
    onDragStart: () => 'Picked up. Use the arrow keys to move it, Space to drop it, Escape to cancel.',
    onDragOver: () => undefined,
    onDragMove: () => undefined,
    onDragEnd: () => 'Dropped.',
    onDragCancel: () => 'Cancelled. It stays where it was.',
  };

  const setOverlay = useCallback((el: HTMLDivElement | null) => {
    overlay.current = el;
  }, []);

  return {
    sensors,
    announcements,
    active,
    target,
    landing,
    setOverlay,
    handlers: { onDragStart, onDragMove, onDragEnd, onDragCancel },
  };
}
