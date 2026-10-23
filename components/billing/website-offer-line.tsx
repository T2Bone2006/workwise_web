import { ArrowUpRight, Globe } from 'lucide-react';
import { WEBSITE_MORE_PAGES_URL, WEBSITE_OFFER } from '@/lib/website-offer';

/**
 * "No website? You get one free." Sits inside a Lite call to action so nobody reads "add Lite to your website" and
 * stops at "I haven't got one". Nothing is bought or asked here: once Lite is added, a card on the Lite pages asks
 * whether they need the website.
 *  - `panel`: under the Add Lite button on the Add Lite pages.
 *  - `line`: one sentence at the foot of a card.
 */
export function WebsiteOfferLine({ variant = 'panel' }: { variant?: 'panel' | 'line' }) {
  if (variant === 'line') {
    return (
      <p className="text-[13px] leading-snug text-muted-foreground">
        No website to put it on? A free one-page site comes with Lite when you stay {WEBSITE_OFFER.monthsToKeep} months.
      </p>
    );
  }
  return (
    <div className="mt-4 flex items-start gap-3 rounded-xl border border-dashed border-(--tone-lite-line) bg-(--tone-lite-soft) p-3.5">
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-card text-(--tone-lite-text) shadow-(--look-card-shadow)"
        aria-hidden
      >
        <Globe className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[13px] leading-snug font-semibold">No website yet? You get one free.</p>
        <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">
          A one-page website with Lily on it, built by {WEBSITE_OFFER.builder} and hosted while you&apos;re on Lite. Stay{' '}
          {WEBSITE_OFFER.monthsToKeep} months and it&apos;s yours to keep. We&apos;ll ask once you&apos;ve added Lite.
        </p>
        <a
          href={WEBSITE_MORE_PAGES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-semibold text-(--tone-lite-text) underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          Need more than one page? Ask Eden
          <ArrowUpRight className="size-3.5" aria-hidden />
        </a>
      </div>
    </div>
  );
}
