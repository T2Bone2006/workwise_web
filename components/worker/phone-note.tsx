import Link from 'next/link';
import { Smartphone } from 'lucide-react';
import { IconChip } from '@/components/look';
import { APP_DOWNLOAD_PATH } from '@/lib/app-stores';
import { cn } from '@/lib/utils';

/** Points the worker at the app for the things the website does not do (accept, start, finish). */
export function PhoneNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border border-(--tone-sky-line) bg-(--tone-sky-soft) px-3.5 py-3 text-sm',
        className,
      )}
    >
      <IconChip icon={Smartphone} tone="sky" size="sm" />
      <p className="min-w-0 flex-1 text-foreground">{children}</p>
      <Link
        href={APP_DOWNLOAD_PATH}
        className="shrink-0 text-sm font-medium text-(--tone-sky-text) underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        Get the app
      </Link>
    </div>
  );
}
