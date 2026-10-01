'use client';

import type { JSX } from 'react';
import { createPortal } from 'react-dom';
import { formatBoardDay } from '@/lib/rounds/week-board';
import { CARD_BOX, StopCardFace } from './board-stop-card';
import type { DndActive, DndTarget } from './use-board-dnd';

/**
 * What floats under the mouse while you drag. It ignores the mouse, and its position is
 * set directly by the drag hook (so it never waits for React).
 */
export function BoardDragOverlay({
  active,
  target,
  joinName,
  attach,
}: {
  active: DndActive | null;
  target: DndTarget;
  /** The name of the visit a card would join, when it would. */
  joinName: string | null;
  attach: (el: HTMLDivElement | null) => void;
}): JSX.Element | null {
  if (!active || typeof document === 'undefined') return null;

  const note =
    active.kind === 'card' && target
      ? !target.valid
        ? "Can't move into the past"
        : joinName
          ? `Join ${joinName}'s visit`
          : null
      : null;

  return createPortal(
    <div
      ref={attach}
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-50 shadow-xl"
      style={active.kind === 'card' ? { width: active.width } : undefined}
    >
      {active.kind === 'card' ? (
        <>
          {note ? (
            <span
              className={
                !target?.valid
                  ? 'absolute -top-7 left-0 rounded-md bg-rose-800 px-2 py-0.5 text-xs font-bold text-white'
                  : 'absolute -top-7 left-0 rounded-md bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground'
              }
            >
              {note}
            </span>
          ) : null}
          <div className={CARD_BOX}>
            <StopCardFace stop={active.stop} />
          </div>
        </>
      ) : (
        <div className="whitespace-nowrap rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">
          {`${formatBoardDay(active.day.date)} · ${active.day.stops.filter((s) => s.movable).length} stops`}
        </div>
      )}
    </div>,
    document.body,
  );
}
