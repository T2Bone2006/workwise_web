import { cn } from '@/lib/utils';
import { toneClasses, type Tone } from './tones';

/** A small label over a figure, for rows of numbers inside a card. */
export function KeyFigure({ label, value, tone = 'slate' }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 text-lg font-semibold tabular-nums', tone === 'slate' ? 'text-foreground' : toneClasses(tone).figure)}>
        {value}
      </p>
    </div>
  );
}
