import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconChip } from './icon-chip';
import type { Tone } from './tones';

/**
 * A white rounded section card with an optional icon chip, title and aside.
 * From Card in workwise_site/components/renderings/screens-rounds.tsx.
 */
export function LookCard({
  title,
  icon,
  tone = 'slate',
  aside,
  className,
  children,
}: {
  title?: string;
  icon?: LucideIcon;
  tone?: Tone;
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const hasHead = Boolean(title || aside);
  return (
    <section
      className={cn('rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-(--look-card-shadow) sm:p-5', className)}
    >
      {hasHead ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {icon ? <IconChip icon={icon} tone={tone} size="sm" /> : null}
            {title ? <h2 className="truncate text-[15px] font-semibold">{title}</h2> : null}
          </div>
          {aside ? <div className="shrink-0 text-sm text-muted-foreground">{aside}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
