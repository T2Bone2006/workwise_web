import type { RoundRow } from '@/lib/rounds/rounds';
import { cn } from '@/lib/utils';

/** A round's colour dot and name: the same small tag wherever a round shows up. */
export function RoundChip({ round, className }: { round: Pick<RoundRow, 'name' | 'colour'>; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border border-border px-2 py-[3px] text-xs font-medium whitespace-nowrap',
        className,
      )}
    >
      <span className="size-2 shrink-0 rounded-full" style={{ background: round.colour }} aria-hidden="true" />
      <span className="truncate">{round.name}</span>
    </span>
  );
}
