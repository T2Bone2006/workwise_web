'use client';

import { toneClasses, type Tone } from '@/components/look';
import { cn } from '@/lib/utils';

export type FilterChip<K extends string> = {
  key: K;
  label: string;
  /** The line under the label, e.g. "£516.50 · 20 customers". */
  detail: string;
  /** A coloured dot before the label: what this group means. */
  tone?: Tone;
};

/**
 * A row of summary tiles that also filter the list below: the figure you see is the list you get.
 * Click the active one again to go back to everything.
 */
export function FilterChips<K extends string>({
  chips,
  value,
  onChange,
  ariaLabel,
}: {
  chips: FilterChip<K>[];
  value: K;
  onChange: (key: K) => void;
  ariaLabel: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden">
      {chips.map((chip) => {
        const active = chip.key === value;
        return (
          <button
            key={chip.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(chip.key)}
            className={cn(
              'min-w-36 shrink-0 rounded-xl border bg-card px-3.5 py-2.5 text-left shadow-(--look-card-shadow) transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
              active ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-(--tone-slate-solid)/40',
            )}
          >
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              {chip.tone ? (
                <span className={cn('size-2.5 rounded-full', toneClasses(chip.tone).solid)} aria-hidden="true" />
              ) : null}
              {chip.label}
            </span>
            <span className="mt-0.5 block text-sm font-semibold tabular-nums">{chip.detail}</span>
          </button>
        );
      })}
    </div>
  );
}
