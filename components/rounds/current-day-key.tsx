import type { JSX } from 'react';
import { parseISO } from 'date-fns';
import { formatBoardDay } from '@/lib/rounds/week-board';

/**
 * Props for a date picker that should show where the job is NOW: that day is ringed in grey, the
 * picker opens on its month, and today keeps the Calendar's own highlight. Spread onto <Calendar>.
 */
export function currentDayProps(current: string | null | undefined, today?: string) {
  if (!current) return {};
  const date = parseISO(current);
  return {
    modifiers: { current: date },
    modifiersClassNames: { current: 'rounded-md ring-2 ring-muted-foreground/50 font-bold' },
    // A day that has already passed isn't worth opening on: start at today instead.
    ...(!today || current >= today ? { defaultMonth: date } : {}),
  };
}

/** The line under a picker: the ringed day is where the job is now. */
export function CurrentDayKey(props: { current: string | null | undefined; label?: string }): JSX.Element | null {
  if (!props.current) return null;
  return (
    <p className="flex items-center gap-2 border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
      <span className="inline-block size-3 rounded-full ring-2 ring-muted-foreground/50" aria-hidden />
      <span>
        <span className="font-semibold text-foreground">
          {props.label ?? 'Now on'} {formatBoardDay(props.current)}
        </span>
        {' · today is highlighted'}
      </span>
    </p>
  );
}
