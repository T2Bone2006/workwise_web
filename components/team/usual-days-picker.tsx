'use client';

import { DAY_LETTERS, DAY_SHORT, usualDaysLabel } from '@/lib/team/usual-days';
import { cn } from '@/lib/utils';

/** Seven small day buttons, Monday first. The worked days are filled. */
export function UsualDaysPicker({
  value,
  onChange,
  disabled,
}: {
  value: number[];
  onChange: (days: number[]) => void;
  disabled?: boolean;
}) {
  const toggle = (day: number) => {
    const next = value.includes(day) ? value.filter((d) => d !== day) : [...value, day];
    onChange(next.sort((a, b) => a - b));
  };
  return (
    <div>
      <div role="group" aria-label="Usual days" className="flex gap-1.5">
        {DAY_LETTERS.map((letter, index) => {
          const day = index + 1;
          const on = value.includes(day);
          return (
            <button
              key={day}
              type="button"
              disabled={disabled}
              onClick={() => toggle(day)}
              aria-pressed={on}
              aria-label={DAY_SHORT[index]}
              className={cn(
                'flex size-9 items-center justify-center rounded-full text-sm font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50',
                on
                  ? 'bg-(--tone-rounds-solid) text-white'
                  : 'border border-border bg-card text-muted-foreground hover:text-foreground',
              )}
            >
              {letter}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">{usualDaysLabel(value)}</p>
    </div>
  );
}
