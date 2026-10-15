import { cn } from '@/lib/utils';

/**
 * What the assistant shows while it works: three dots hopping in a wave, and
 * the status line ("Looking at your calendar…", "Writing…") under a moving
 * shimmer. Reduced motion: both hold still.
 */
export function Thinking({ label, lite = false, className }: { label: string; lite?: boolean; className?: string }) {
  const tint = lite ? 'var(--tone-lite-solid)' : 'var(--tone-rounds-solid)';
  return (
    <p className={cn('flex items-center gap-2.5', className)} role="status" aria-live="polite" style={{ ['--ai-tint' as string]: tint }}>
      <span className="flex h-5 shrink-0 items-end gap-1 pb-1" aria-hidden>
        <span className="ai-dot" />
        <span className="ai-dot" />
        <span className="ai-dot" />
      </span>
      <span className="ai-shimmer text-sm font-medium">{label}</span>
    </p>
  );
}

/** "Working…" on a solid Do it button. */
export function WorkingLabel({ label = 'Working…' }: { label?: string }) {
  return <span className="ai-shimmer-on-solid">{label}</span>;
}
