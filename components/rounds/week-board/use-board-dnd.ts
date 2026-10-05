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

function clientPoint(event: Event | null | undefined): { x: number; y: number } | null {
  if (!event) return null;
  if (typeof TouchEvent !== 'undefined' && event instanceof TouchEvent) {
    const touch = event.touches[0] ?? event.changedTouches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  }
  if (event instanceof MouseEvent) return { x: event.clientX, y: event.clientY };
  return null;
}

/** Scrollable parents, the same ones dnd-kit adds into the drag delta. */
function scrollableAncestors(node: Element | null): HTMLElement[] {
  const found: HTMLElement[] = [];
  let current: Node | null = node;
  while (current) {
    if (current instanceof HTMLElement && current !== node) {
      const style = getComputedStyle(current);
      if (/(auto|scroll|overlay)/.test(`${style.overflow}${style.overflowX}${style.overflowY}`)) {
        found.push(current);
      }
      if (style.position === 'fixed') break;
    }
    if (current instanceof Document) {
      const scrolling = current.scrollingElement;
      if (scrolling instanceof HTMLElement && !found.includes(scrolling)) found.push(scrolling);
      break;
    }
    current = current.parentNode;
  }
  return found;
}

function scrollOf(nodes: readonly HTMLElement[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const node of nodes) {
    x += node.scrollLeft;
    y += node.scrollTop;
  }
  return { x, y };
}

type HeldScroll = { left: number; top: number; width: number; board: boolean };

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
 *
 * The copy follows the pointer. dnd-kit's delta also includes every scroll since the
 * drag started, so positioning from that delta walks the copy off the cursor, which
 * then keeps the week scrolling at full speed.
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
  /** Where the lifted card started on screen. */
  const start = useRef({ left: 0, top: 0, width: 0, height: 0 });
  /** Where on the card the pointer went down, so the same spot stays under the cursor. */
  const grab = useRef({ x: 0, y: 0 });
  const placed = useRef({ left: 0, top: 0, scale: 1 });
  const frame = useRef<number | null>(null);
  /** Pointer drags follow the cursor. Keyboard drags follow the arrow keys, with scroll taken back out. */
  const pointerDriven = useRef(false);
  const tracking = useRef(false);
  /** True while this hook is the one changing scroll, so the hold below doesn't undo it. */
  const writingScroll = useRef(false);
  const heldScroll = useRef(new Map<HTMLElement, HeldScroll>());
  /** Ancestors whose scroll dnd-kit folds into the keyboard delta. */
  const scrollNodes = useRef<HTMLElement[]>([]);
  const scrollBase = useRef({ x: 0, y: 0 });

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

  /**
   * The week and the page also scroll on their own when the pointer leaves the window,
   * and that scroll speeds up the further out it is. Hold them to the position we set.
   * A change of width is a week being loaded: keep that correction.
   */
  const holdScroll = useCallback((event: Event) => {
    if (!tracking.current || writingScroll.current) return;
    let node: EventTarget | null = event.target;
    if (node === document) node = document.scrollingElement;
    if (!(node instanceof HTMLElement)) return;
    const held = heldScroll.current.get(node);
    if (!held) return;
    if (held.board && node.scrollWidth !== held.width) {
      heldScroll.current.set(node, { ...held, left: node.scrollLeft, top: node.scrollTop, width: node.scrollWidth });
      return;
    }
    if (node.scrollLeft === held.left && node.scrollTop === held.top) return;
    writingScroll.current = true;
    node.scrollLeft = held.left;
    node.scrollTop = held.top;
    writingScroll.current = false;
    if (node.scrollLeft !== held.left || node.scrollTop !== held.top) {
      heldScroll.current.set(node, { ...held, left: node.scrollLeft, top: node.scrollTop, width: node.scrollWidth });
    }
  }, []);

  const watchScrolling = useCallback(
    (origin: Element | null) => {
      const board = latest.current.scroller.current;
      const next = new Map<HTMLElement, HeldScroll>();
      for (const el of scrollableAncestors(origin)) {
        // Day columns scroll on purpose while a card is over them. Everything else stays put.
        if (el.hasAttribute('data-col-scroll')) continue;
        next.set(el, { left: el.scrollLeft, top: el.scrollTop, width: el.scrollWidth, board: el === board });
      }
      if (board && !next.has(board)) {
        next.set(board, { left: board.scrollLeft, top: board.scrollTop, width: board.scrollWidth, board: true });
      }
      heldScroll.current = next;
      window.addEventListener('scroll', holdScroll, true);
    },
    [holdScroll],
  );

  const movePointer = useCallback(
    (x: number, y: number) => {
      if (!tracking.current || !pointerDriven.current || !activeRef.current) return;
      const { width, height } = start.current;
      const left = x - grab.current.x;
      const top = y - grab.current.y;
      center.current = { x: left + width / 2, y: top + height / 2 };
      placed.current = { left, top, scale: 1.03 };
      const el = overlay.current;
      if (el) el.style.transform = `translate3d(${left}px, ${top}px, 0) scale(1.03)`;
      updateTarget();
    },
    [updateTarget],
  );
  const movePointerRef = useRef(movePointer);
  movePointerRef.current = movePointer;

  const onPointerMove = useCallback((event: PointerEvent) => {
    movePointerRef.current(event.clientX, event.clientY);
  }, []);
  const onTouchMove = useCallback((event: TouchEvent) => {
    const touch = event.touches[0];
    if (touch) movePointerRef.current(touch.clientX, touch.clientY);
  }, []);

  const release = useCallback(() => {
    tracking.current = false;
    pointerDriven.current = false;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('scroll', holdScroll, true);
    heldScroll.current.clear();
  }, [holdScroll, onPointerMove, onTouchMove]);

  /** Scroll the board sideways, and the column under the card up or down, when the card is near an edge. */
  const tick = useCallback(() => {
    if (!tracking.current || !activeRef.current) {
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
        writingScroll.current = true;
        scrollerEl.scrollLeft = before + dx;
        writingScroll.current = false;
        const held = heldScroll.current.get(scrollerEl);
        if (held) {
          heldScroll.current.set(scrollerEl, {
            ...held,
            left: scrollerEl.scrollLeft,
            top: scrollerEl.scrollTop,
            width: scrollerEl.scrollWidth,
          });
        }
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

  useEffect(
    () => () => {
      stopLoop();
      release();
    },
    [release, stopLoop],
  );

  const place = useCallback((left: number, top: number, scale: number) => {
    placed.current = { left, top, scale };
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
      release();
      tracking.current = true;
      activeRef.current = next;
      setActive(next);
      const origin = pressedElement(event);
      scrollNodes.current = scrollableAncestors(origin);
      scrollBase.current = scrollOf(scrollNodes.current);
      const point = clientPoint(event.activatorEvent);
      if (rect) {
        start.current = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
        center.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        place(rect.left, rect.top, 1.03);
        if (point) {
          grab.current = { x: point.x - rect.left, y: point.y - rect.top };
          pointerDriven.current = true;
          window.addEventListener('pointermove', onPointerMove);
          window.addEventListener('touchmove', onTouchMove, { passive: true });
        }
      }
      watchScrolling(origin);
      updateTarget();
      stopLoop();
      frame.current = requestAnimationFrame(() => tickRef.current());
    },
    [dayAt, onPointerMove, onTouchMove, place, release, stopLoop, updateTarget, watchScrolling],
  );

  const onDragMove = useCallback(
    (event: DragMoveEvent) => {
      // Pointer drags are positioned from the cursor. This delta includes scroll, which is what ran away.
      if (!tracking.current || !activeRef.current || pointerDriven.current) return;
      const { left, top, width, height } = start.current;
      const now = scrollOf(scrollNodes.current);
      const x = left + event.delta.x - (now.x - scrollBase.current.x);
      const y = top + event.delta.y - (now.y - scrollBase.current.y);
      center.current = { x: x + width / 2, y: y + height / 2 };
      place(x, y, 1.03);
      updateTarget();
    },
    [place, updateTarget],
  );

  const finish = useCallback(() => {
    stopLoop();
    release();
    activeRef.current = null;
    targetRef.current = null;
    setActive(null);
    setTargetState(null);
    setLanding(false);
  }, [release, stopLoop]);

  const onDragEnd = useCallback(
    () => {
      const current = activeRef.current;
      const over = targetRef.current;
      if (!current) return;
      stopLoop();
      release();

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
    if (!el) return;
    const { left, top, scale } = placed.current;
    el.style.transform = `translate3d(${left}px, ${top}px, 0) scale(${scale})`;
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
