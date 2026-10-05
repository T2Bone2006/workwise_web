import { cn } from '@/lib/utils';
import { toneClasses, type Tone } from './tones';

/**
 * The tone pill: one short word that always means the same thing.
 * From AppTag in workwise_site/components/renderings/app-kit.tsx.
 */
export function Tag({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-xs font-medium whitespace-nowrap',
        toneClasses(tone).chip,
        className,
      )}
    >
      {children}
    </span>
  );
}
