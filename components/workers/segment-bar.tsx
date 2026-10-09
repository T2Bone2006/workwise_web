'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export type BarSegment = {
  count: number;
  /** Named in the legend underneath: every colour on screen says what it is. */
  label: string;
  barClass: string;
  dotClass: string;
  /** Legend text in the strong colour (the thing being asked about). */
  strong?: boolean;
};

/**
 * A bar split into segments (workers on the plan, room left, extras...). Grows in on mount.
 * Segments with a count of 0 are left out of both the bar and the legend.
 */
export function SegmentBar({ segments }: { segments: BarSegment[] }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const visible = segments.filter((s) => s.count > 0);
  const total = visible.reduce((sum, s) => sum + s.count, 0) || 1;

  return (
    <div>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-muted">
        {visible.map((s) => (
          <span
            key={s.label}
            className={cn('transition-[width] duration-700 ease-out motion-reduce:transition-none', s.barClass)}
            style={{ width: `${shown ? (s.count / total) * 100 : 0}%` }}
          />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        {visible.map((s) => (
          <li key={s.label} className={cn('flex items-center gap-1.5', s.strong && 'font-medium text-foreground')}>
            <span className={cn('size-2 rounded-full', s.dotClass)} aria-hidden="true" />
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export const BAR_COLOURS = {
  plan: { barClass: 'bg-primary', dotClass: 'bg-primary' },
  spare: { barClass: 'bg-muted-foreground/25', dotClass: 'bg-muted-foreground/40' },
  extraEarlier: {
    barClass: 'bg-amber-300 dark:bg-amber-500/50',
    dotClass: 'bg-amber-300 dark:bg-amber-500/50',
  },
  extra: { barClass: 'bg-amber-500', dotClass: 'bg-amber-500' },
} as const;
