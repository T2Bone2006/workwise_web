'use client';

import {
  PointerSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';

/** What a card or a group box carries while it is in the air. */
export type CalendarDrag = {
  kind: 'job' | 'group';
  jobIds: string[];
  /** The column or lane it was picked up from. */
  from: string;
};

/** Where a drop would land: a column or lane, and the place among the jobs staying there. */
export type Hover = { key: string; index: number };

/** Droppable ids are `drop:<key>`; the element carries `data-drop="<key>"` so the cards inside can be measured. */
export function dropId(key: string): string {
  return `drop:${key}`;
}

function keyOf(id: string | number | undefined): string | null {
  const text = String(id ?? '');
  return text.startsWith('drop:') ? text.slice(5) : null;
}

function pointerY(event: DragOverEvent | DragEndEvent): number | null {
  const activator = event.activatorEvent;
  if (activator instanceof MouseEvent) return activator.clientY + event.delta.y;
  if (typeof TouchEvent !== 'undefined' && activator instanceof TouchEvent) {
    const touch = activator.touches[0] ?? activator.changedTouches[0];
    return touch ? touch.clientY + event.delta.y : null;
  }
  return null;
}

/**
 * The place under the pointer. Cards that are in the air are not counted, and the gap already open is allowed for,
 * so the gap doesn't jump about as it opens.
 */
export function hoverFromEvent(
  event: DragOverEvent | DragEndEvent,
  current: Hover | null,
  lifted: ReadonlySet<string>,
  gapHeight: number,
): Hover | null {
  const key = keyOf(event.over?.id);
  if (!key) return null;
  const y = pointerY(event);
  const area = document.querySelector(`[data-drop="${CSS.escape(key)}"]`);
  if (!area || y == null) return { key, index: 0 };
  // A card is one place; a folded group is as many places as it has jobs (its cards aren't drawn).
  const items = [...area.querySelectorAll<HTMLElement>('[data-job-id], [data-folded-jobs]')];
  const gapBefore = current?.key === key ? current.index : null;
  let place = 0;
  for (const item of items) {
    const ids = item.dataset.jobId ? [item.dataset.jobId] : (item.dataset.foldedJobs ?? '').split(' ').filter(Boolean);
    const count = ids.filter((id) => !lifted.has(id)).length;
    if (count === 0) continue;
    const rect = item.getBoundingClientRect();
    const shift = gapBefore != null && place >= gapBefore ? gapHeight : 0;
    if (y < rect.top - shift + rect.height / 2) return { key, index: place };
    place += count;
  }
  return { key, index: place };
}

export const calendarCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

/** A small move picks a card up with the mouse; on a phone you hold it first, so the page still scrolls. */
export function useCalendarSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
  );
}

export function signatureOf(jobs: ReadonlyArray<{ id: string; date: string | null; position: number | null; status: string | null; workerId: string | null }>): string {
  return jobs.map((job) => `${job.id}:${job.date ?? ''}:${job.position ?? ''}:${job.status ?? ''}:${job.workerId ?? ''}`).join('|');
}
