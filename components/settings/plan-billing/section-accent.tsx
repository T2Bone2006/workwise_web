import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Soft colour for the Plan & billing sections: a small coloured icon beside the heading and a faint wash on the card. */
const TONES = {
  blue: { chip: 'bg-blue-500/15 text-blue-600 dark:text-blue-300', wash: 'from-blue-500/[0.07]', top: 'border-t-blue-500/60!' },
  violet: { chip: 'bg-violet-500/15 text-violet-600 dark:text-violet-300', wash: 'from-violet-500/[0.07]', top: 'border-t-violet-500/60!' },
  emerald: { chip: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300', wash: 'from-emerald-500/[0.07]', top: 'border-t-emerald-500/60!' },
  amber: { chip: 'bg-amber-500/15 text-amber-600 dark:text-amber-300', wash: 'from-amber-500/[0.07]', top: 'border-t-amber-500/60!' },
} as const;

export type AccentTone = keyof typeof TONES;

export function SectionHeading({ id, icon: Icon, tone, children }: { id: string; icon: LucideIcon; tone: AccentTone; children: React.ReactNode }) {
  return (
    <h2 id={id} className="flex items-center gap-2 text-sm font-semibold">
      <span className={cn('grid size-6 place-items-center rounded-md', TONES[tone].chip)} aria-hidden>
        <Icon className="size-3.5" />
      </span>
      {children}
    </h2>
  );
}

/** Class names for a card that gets the faint wash and a coloured top edge. Use with `relative overflow-hidden`. */
export function accentCardClass(tone: AccentTone): string {
  return cn('relative overflow-hidden border-t-2 bg-gradient-to-br to-transparent', TONES[tone].wash, TONES[tone].top);
}
