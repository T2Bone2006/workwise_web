import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

const STEPS = ['Where from', 'Check', 'Done'] as const;

/** The three stages of the import, so you always know how far along you are. `current` is 1, 2 or 3. */
export function ImportSteps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol className="flex items-center gap-2 text-sm" aria-label="Import progress">
      {STEPS.map((label, index) => {
        const number = index + 1;
        const done = number < current;
        const active = number === current;
        return (
          <li key={label} className="flex items-center gap-2" aria-current={active ? 'step' : undefined}>
            <span
              className={cn(
                'flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                done && 'bg-(--tone-emerald-solid) text-white',
                active && 'bg-primary text-primary-foreground',
                !done && !active && 'bg-muted text-muted-foreground',
              )}
            >
              {done ? <Check className="size-3.5" aria-hidden="true" /> : number}
            </span>
            <span className={cn('font-medium whitespace-nowrap', active ? 'text-foreground' : 'text-muted-foreground')}>{label}</span>
            {number < STEPS.length ? (
              <span className={cn('mx-1 h-px w-6 sm:w-10', done ? 'bg-(--tone-emerald-solid)' : 'bg-border')} aria-hidden="true" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
