import type { JSX } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const tones = {
  sky: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  violet: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  emerald: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
  amber: 'bg-amber-500/15 text-amber-800 dark:text-amber-200',
  rose: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
} as const;

export function CustomerSectionTitle(props: {
  icon: LucideIcon;
  title: string;
  tone: keyof typeof tones;
  hint?: string;
  as?: 'h2' | 'h3';
}): JSX.Element {
  const Icon = props.icon;
  const Heading = props.as ?? 'h2';
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-lg',
          tones[props.tone],
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <Heading className="text-base font-semibold leading-tight">{props.title}</Heading>
        {props.hint ? <p className="text-xs text-muted-foreground">{props.hint}</p> : null}
      </div>
    </div>
  );
}
