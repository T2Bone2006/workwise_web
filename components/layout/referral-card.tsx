'use client';

import Link from 'next/link';
import { ChevronRight, Gift } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** Quiet sidebar row that opens the referral page. A single line, so it can sit under Add Lite. */
export function ReferralCard({ collapsed }: { collapsed: boolean }) {
  if (collapsed) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href="/refer"
              aria-label="Refer a trader: you both get a month free"
              className="flex size-9 items-center justify-center rounded-xl bg-(--tone-emerald-soft) text-(--tone-emerald-text) transition-colors hover:bg-(--tone-emerald-line) focus-visible:ring-2 focus-visible:ring-(--tone-emerald-solid) focus-visible:outline-none"
            >
              <Gift className="size-4" aria-hidden />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">Refer a trader, you both get a month free</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Link
      href="/refer"
      className={cn(
        'group flex w-full items-center gap-2.5 rounded-xl border border-(--tone-emerald-line) bg-(--tone-emerald-soft) p-2 pr-2.5 text-left',
        'transition-shadow hover:shadow-(--look-card-shadow)',
        'focus-visible:ring-2 focus-visible:ring-(--tone-emerald-solid) focus-visible:outline-none'
      )}
    >
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-(--look-green-pill) text-white"
        aria-hidden
      >
        <Gift className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] leading-tight font-semibold text-card-foreground">Refer a trader</span>
        <span className="mt-0.5 block text-[11.5px] leading-tight text-(--tone-emerald-text)">Both get a month free</span>
      </span>
      <ChevronRight className="size-3.5 shrink-0 text-(--tone-emerald-text) opacity-70" aria-hidden />
    </Link>
  );
}
