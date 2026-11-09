import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * The WorkWise logo mark (bar + tick) on a transparent background.
 * Blue bar + gold tick in light mode, white bar + yellow tick in dark mode.
 * Sized by width: the mark is 1.84 times wider than it is tall.
 */
export function BrandMark({
  width,
  className,
  alt = '',
  priority,
}: {
  width: number;
  className?: string;
  alt?: string;
  priority?: boolean;
}) {
  const height = Math.round(width / 1.8434);
  return (
    <>
      <Image
        src="/brand/icon-colour.svg"
        alt={alt}
        width={width}
        height={height}
        priority={priority}
        className={cn('shrink-0 dark:hidden', className)}
      />
      <Image
        src="/brand/icon-reversed.svg"
        alt={alt}
        width={width}
        height={height}
        priority={priority}
        className={cn('hidden shrink-0 dark:block', className)}
      />
    </>
  );
}
