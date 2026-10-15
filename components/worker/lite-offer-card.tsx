'use client';

import Link from 'next/link';
import { MessageCircle, X } from 'lucide-react';
import { Tag } from '@/components/look';
import { Button } from '@/components/ui/button';
import { useStoredFlag } from '@/components/rounds/use-stored-flag';

/**
 * The quiet Lite offer on the worker pages, for a self-employed worker. It can be closed on this browser
 * (the sidebar card stays), and a blocked browser store simply means it shows every time.
 */
export function LiteOfferCard({ employerName }: { employerName: string }) {
  const [dismissed, setDismissed] = useStoredFlag('ww-worker-lite-offer-dismissed', false);
  if (dismissed) return null;
  return (
    <section
      aria-label="Add Lite"
      className="relative rounded-2xl border border-(--tone-lite-line) bg-(--tone-lite-soft) p-4 sm:p-5"
    >
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Hide this for now"
        className="absolute top-3 right-3 flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-card/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <X className="size-4" aria-hidden />
      </button>
      <Tag tone="lite">
        <MessageCircle className="size-3" aria-hidden />
        Lite
      </Tag>
      <h2 className="mt-2.5 pr-8 text-[17px] leading-snug font-semibold tracking-tight">Win your own work too</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        You work with {employerName} through WorkWise. Because of that, Lite is 20% off for you:{' '}
        <strong className="font-semibold text-foreground">£28 a month</strong>, instead of £35.
      </p>
      <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button asChild size="sm" className="rounded-full bg-(--look-lite-pill) text-white hover:bg-(--look-lite-pill)/90">
          <Link href="/add-lite">See Lite</Link>
        </Button>
        <p className="text-xs text-muted-foreground">The price stays while you&apos;re connected to a Pro account.</p>
      </div>
    </section>
  );
}
