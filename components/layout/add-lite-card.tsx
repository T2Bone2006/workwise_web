'use client';

import Link from 'next/link';
import { ChevronRight, MessageCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** Sidebar nudge for Rounds-only accounts. No dismiss. Yearly plans show +£240 a year. */
export function AddLiteCard({ collapsed, yearly }: { collapsed: boolean; yearly: boolean }) {
  const price = yearly ? '+£240 a year' : '+£24 a month';

  if (collapsed) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href="/add-lite"
              aria-label={`Add Lite, ${price}`}
              className="flex size-9 items-center justify-center rounded-xl bg-(--look-lite-pill) text-white shadow-(--look-card-shadow) transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-(--look-lite) focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
            >
              <MessageCircle className="size-4" aria-hidden />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">Add Lite, {price}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Link
      href="/add-lite"
      className={cn(
        'group block w-full rounded-2xl border border-(--tone-lite-line) bg-(--tone-lite-soft) p-2.5 text-left',
        'transition-shadow hover:shadow-(--look-card-shadow)',
        'focus-visible:ring-2 focus-visible:ring-(--look-lite) focus-visible:outline-none'
      )}
    >
      {/* A customer asking on your website, and the answer Lite gives */}
      <span className="flex flex-col gap-1" aria-hidden>
        <span className="max-w-[88%] self-start rounded-xl rounded-bl-sm bg-card px-2 py-1 text-[11px] leading-tight text-card-foreground shadow-(--look-card-shadow)">
          How much for the windows?
        </span>
        <span className="max-w-[88%] self-end rounded-xl rounded-br-sm bg-(--look-lite-pill) px-2 py-1 text-[11px] leading-tight text-white">
          £18. Thursday work?
        </span>
      </span>

      <span className="mt-2.5 block px-0.5 text-[13px] leading-none font-semibold text-card-foreground">Add Lite</span>
      <span className="mt-1 block px-0.5 text-[11.5px] leading-snug text-muted-foreground">
        Quotes customers from your website while you work.
      </span>

      <span className="mt-2.5 flex items-center justify-between rounded-lg bg-(--look-lite-pill) py-1.5 pr-1.5 pl-2.5 text-[12px] font-semibold text-white transition-opacity group-hover:opacity-90">
        <span className="tabular-nums">{price}</span>
        <ChevronRight className="size-3.5 opacity-80" aria-hidden />
      </span>
    </Link>
  );
}
