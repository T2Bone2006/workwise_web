'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowUpRight, ChevronRight, Handshake } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Sidebar nudge to the Pro page. No dismiss. */
export function PortalProCard({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = pathname === '/portal/pro' || pathname.startsWith('/portal/pro/');

  return (
    <Link
      href="/portal/pro"
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group block w-full rounded-2xl border border-(--tone-rounds-line) bg-(--tone-rounds-soft) p-2.5 text-left',
        'transition-shadow hover:shadow-(--look-card-shadow)',
        'focus-visible:ring-2 focus-visible:ring-(--look-rounds) focus-visible:outline-none',
        active && 'ring-2 ring-(--look-rounds)',
      )}
    >
      <span className="flex flex-col gap-1" aria-hidden>
        <span className="max-w-[88%] self-start rounded-xl rounded-bl-sm bg-card px-2 py-1 text-[11px] leading-tight text-card-foreground shadow-(--look-card-shadow)">
          Boiler, 14 Mill Lane
        </span>
        <span className="max-w-[88%] self-end rounded-xl rounded-br-sm bg-(--look-rounds-pill) px-2 py-1 text-[11px] leading-tight text-white">
          Sent to a partner
        </span>
      </span>

      <span className="mt-2.5 flex items-center gap-1.5 px-0.5 text-[13px] leading-none font-semibold text-card-foreground">
        <Handshake className="size-3.5 text-(--tone-rounds-text)" aria-hidden />
        WorkWise Pro
      </span>
      <span className="mt-1 block px-0.5 text-[11.5px] leading-snug text-muted-foreground">
        Run your own jobs, and send work on the Partner network.
      </span>

      <span className="mt-2.5 flex items-center justify-between rounded-lg bg-(--look-rounds-pill) py-1.5 pr-1.5 pl-2.5 text-[12px] font-semibold text-white transition-opacity group-hover:opacity-90">
        <span>See Pro</span>
        <ChevronRight className="size-3.5 opacity-80" aria-hidden />
      </span>
    </Link>
  );
}

/** Small header button on Your jobs. */
export function PortalProHeaderLink() {
  return (
    <Link
      href="/portal/pro"
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-amber-300 px-3 text-sm font-semibold text-slate-900 shadow-sm hover:bg-amber-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      Join Pro
      <ArrowUpRight className="size-3.5" aria-hidden />
    </Link>
  );
}
