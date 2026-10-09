'use client';

import Link from 'next/link';
import { ChevronRight, Gift } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ReferralKind } from '@/lib/data/referral-nudge';
import { PRO_SIDEBAR_WORDING } from '@/components/referrals/pro-referral-copy';

/** Quiet sidebar row that opens the referral page. A single line, so it can sit under Add Lite. */
export function ReferralCard({ collapsed, kind = 'rounds_lite' }: { collapsed: boolean; kind?: ReferralKind }) {
  const pro = kind === 'pro';
  const title = pro ? PRO_SIDEBAR_WORDING.title : 'Refer a trader';
  const line = pro ? PRO_SIDEBAR_WORDING.line : 'Both get a month free';
  const label = pro ? PRO_SIDEBAR_WORDING.collapsed : 'Refer a trader: you both get a month free';
  const tip = pro ? PRO_SIDEBAR_WORDING.collapsed : 'Refer a trader, you both get a month free';
  if (collapsed) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href="/refer"
              aria-label={label}
              className="flex size-9 items-center justify-center rounded-xl bg-(--tone-emerald-soft) text-(--tone-emerald-text) transition-colors hover:bg-(--tone-emerald-line) focus-visible:ring-2 focus-visible:ring-(--tone-emerald-solid) focus-visible:outline-none"
            >
              <Gift className="size-4" aria-hidden />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">{tip}</TooltipContent>
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
        <span className="block text-[13px] leading-tight font-semibold text-card-foreground">{title}</span>
        <span className="mt-0.5 block text-[11.5px] leading-tight text-(--tone-emerald-text)">{line}</span>
      </span>
      <ChevronRight className="size-3.5 shrink-0 text-(--tone-emerald-text) opacity-70" aria-hidden />
    </Link>
  );
}
