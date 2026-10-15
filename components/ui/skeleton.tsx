import { cn } from '@/lib/utils';

/** A grey placeholder block with a moving shimmer. Size and shape come from className. */
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div aria-hidden className={cn('skeleton rounded-md', className)} {...props} />;
}
