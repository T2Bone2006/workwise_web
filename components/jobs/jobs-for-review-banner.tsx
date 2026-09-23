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
        'flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 backdrop-blur-sm',
        'border-border/70 bg-gradient-to-br from-amber-100/95 via-amber-50/85 to-yellow-100/80',
        'shadow-[0_1px_0_rgba(245,158,11,0.12),0_10px_28px_-14px_rgba(245,158,11,0.28)]',
        'dark:border-white/[0.08] dark:from-amber-950/50 dark:via-background dark:to-yellow-950/25 dark:shadow-none',
        className
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl border border-border/60 bg-amber-500/15 backdrop-blur-sm dark:border-white/10 dark:bg-amber-500/10">
          <ClipboardList className="size-5 text-amber-800 dark:text-amber-300" />
        </div>
        <div>
          <p className="font-medium text-amber-950 dark:text-amber-100">
            {count} job{count === 1 ? '' : 's'} need{count === 1 ? 's' : ''} assignment
          </p>
          <p className="text-sm text-amber-900/80 dark:text-amber-200/75">
            Assign workers from the review flow for a quick, one-by-one workflow.
          </p>
        </div>
      </div>
      <Button
        variant="outline"
        size="default"
        className="shrink-0 border-border/70 bg-amber-500/10 backdrop-blur-sm hover:bg-amber-500/20 dark:border-white/10 dark:bg-amber-500/10 dark:hover:bg-amber-500/20"
        asChild
      >
        <Link href="/jobs/review">
          <ClipboardList className="size-4" />
          Jobs for review
        </Link>
      </Button>
    </div>
  );
}
