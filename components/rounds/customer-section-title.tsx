import type { JSX } from 'react';
import type { LucideIcon } from 'lucide-react';
import { toneClasses } from '@/components/look';
import { cn } from '@/lib/utils';

const tones = {
  sky: toneClasses('sky').chip,
  violet: toneClasses('violet').chip,
  emerald: toneClasses('emerald').chip,
  amber: toneClasses('amber').chip,
  rose: toneClasses('rose').chip,
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
          'flex size-8 shrink-0 items-center justify-center rounded-xl',
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
