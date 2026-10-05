import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toneClasses, type Tone } from './tones';

const SIZES = {
  sm: { box: 'size-7 rounded-lg', icon: 'size-3.5' },
  md: { box: 'size-9 rounded-xl', icon: 'size-[18px]' },
} as const;

/**
 * A soft rounded tile with the icon in the tone's ink.
 * From IconChip in workwise_site/components/renderings/app-kit.tsx.
 */
export function IconChip({ icon: Icon, tone, size = 'md' }: { icon: LucideIcon; tone: Tone; size?: 'sm' | 'md' }) {
  return (
    <span
      className={cn('flex shrink-0 items-center justify-center', SIZES[size].box, toneClasses(tone).chip)}
      aria-hidden="true"
    >
      <Icon className={SIZES[size].icon} />
    </span>
  );
}
