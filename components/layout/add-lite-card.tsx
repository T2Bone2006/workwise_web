'use client';

import Link from 'next/link';
import { ChevronRight, MessageCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { GiftBox } from '@/components/billing/gift-box';
import { WEBSITE_OFFER } from '@/lib/website-offer';

/**
 * Sidebar nudge to add Lite. No dismiss. Lite is purple, so the card is a solid purple call to action, with a small
 * navy box inside it for the free one-page website (the same navy, blue box and yellow ribbon as the Add Lite page).
 * Rounds-only accounts: +£24 a month (+£240 a year).
 * A self-employed worker (`worker`): Lite at the worker price, £28 a month, with the usual £35 struck through.
 */
export function AddLiteCard({
  collapsed,
  yearly,
  worker = false,
}: {
  collapsed: boolean;
  yearly: boolean;
  worker?: boolean;
}) {
  const price = worker ? '£28 a month' : yearly ? '+£240 a year' : '+£24 a month';

  if (collapsed) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href="/add-lite"
              aria-label={`Add Lite, ${price}. A free one-page website is included.`}
              className="relative flex size-9 items-center justify-center rounded-xl bg-(--look-lite-pill) text-white shadow-(--look-card-shadow) transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-(--look-lite) focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
            >
              <MessageCircle className="size-4" aria-hidden />
              <span
                aria-hidden
                className="absolute -top-1.5 -right-1.5 flex size-[18px] items-center justify-center rounded-full bg-[#0A1A2E] ring-2 ring-background"
              >
                <GiftBox site={false} className="size-3.5" />
              </span>
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">Add Lite, {price}. Free website included.</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Link
      href="/add-lite"
      className={cn(
        'group block w-full rounded-2xl bg-(--look-lite-pill) p-3 text-left text-white shadow-(--look-card-shadow)',
        'transition-[filter] hover:brightness-110',
        'focus-visible:ring-2 focus-visible:ring-(--look-lite) focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none'
      )}
    >
      <span className="block text-[15px] leading-none font-semibold">Add Lite</span>
      <span className="mt-1.5 block text-[11.5px] leading-snug text-white/85">
        {worker ? 'Lily answers customers on your own website while you work.' : 'Quotes customers from your website while you work.'}
      </span>

      {/* The free one-page website, in the navy box with the blue gift and yellow ribbon */}
      <span className="mt-2.5 flex items-center gap-2.5 rounded-xl bg-[#0A1A2E] p-2">
        <GiftBox site={false} className="w-10 shrink-0" />
        <span className="min-w-0">
          <span className="block text-[12.5px] leading-tight font-semibold text-white">Free website included</span>
          <span className="mt-0.5 block text-[10.5px] leading-tight text-white/65">
            Yours to keep after {WEBSITE_OFFER.monthsToKeep} months
          </span>
        </span>
      </span>

      {worker ? (
        <span className="mt-2.5 flex items-center gap-1.5 text-[11px] leading-none text-white/80">
          <s className="tabular-nums">£35</s>
          <span className="rounded-full bg-white/20 px-1.5 py-0.5 font-semibold text-white">20% off</span>
        </span>
      ) : null}

      <span className="mt-2.5 flex items-center justify-between rounded-lg bg-white py-1.5 pr-1.5 pl-2.5 text-[12.5px] font-semibold text-[#7A1FB5] transition-opacity group-hover:opacity-95">
        <span className="tabular-nums">{price}</span>
        <ChevronRight className="size-3.5 opacity-80" aria-hidden />
      </span>
    </Link>
  );
}
