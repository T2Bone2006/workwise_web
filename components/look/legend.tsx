import { cn } from '@/lib/utils';
import { toneClasses, type Tone } from './tones';

/** What each colour on a chart or board means. Every coloured thing gets one. */
export function Legend({ items, className }: { items: { label: string; tone: Tone }[]; className?: string }) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground', className)}>
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span className={cn('size-2.5 rounded-full', toneClasses(item.tone).solid)} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
