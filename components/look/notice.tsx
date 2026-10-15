import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconChip } from './icon-chip';
import { toneClasses, type Tone } from './tones';

/**
 * A banner that asks for one thing: an icon chip, a title, a line of why,
 * and the button that does it. Tinted by what it means (amber = needs attention).
 */
export function Notice({
  tone = 'amber',
  icon,
  title,
  children,
  action,
  className,
}: {
  tone?: Tone;
  icon: LucideIcon;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const classes = toneClasses(tone);
  return (
    <section
      className={cn(
        'flex flex-col gap-4 rounded-2xl border p-4 sm:flex-row sm:items-center sm:gap-5 sm:p-5',
        classes.soft,
        classes.border,
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3.5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-card/70">
          <IconChip icon={icon} tone={tone} />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
          {children ? <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{children}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </section>
  );
}
