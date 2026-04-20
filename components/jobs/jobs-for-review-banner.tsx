'use client';

import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface JobsForReviewBannerProps {
  count: number;
  className?: string;
}

export function JobsForReviewBanner({ count, className }: JobsForReviewBannerProps) {
  if (count <= 0) return null;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 shadow-[0_0_20px_-6px_rgba(245,158,11,0.2)]',
        'dark:border-amber-400/30 dark:bg-amber-500/5',
        className
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-amber-500/20 dark:bg-amber-500/10">
          <ClipboardList className="size-5 text-amber-700 dark:text-amber-400" />
        </div>
        <div>
          <p className="font-medium text-amber-900 dark:text-amber-100">
            {count} job{count === 1 ? '' : 's'} need{count === 1 ? 's' : ''} assignment
          </p>
          <p className="text-sm text-amber-800/90 dark:text-amber-200/80">
            Assign workers from the review flow for a quick, one-by-one workflow.
          </p>
        </div>
      </div>
      <Button variant="outline" size="default" className="shrink-0 border-amber-400/50 bg-amber-500/10 hover:bg-amber-500/20 dark:border-amber-400/30 dark:bg-amber-500/10 dark:hover:bg-amber-500/20" asChild>
        <Link href="/jobs/review">
          <ClipboardList className="size-4" />
          Jobs for review
        </Link>
      </Button>
    </div>
  );
}
