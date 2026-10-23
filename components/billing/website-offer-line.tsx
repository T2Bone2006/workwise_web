import { ArrowUpRight } from 'lucide-react';
import { GiftBox } from '@/components/billing/gift-box';
import { WEBSITE_MORE_PAGES_URL, WEBSITE_OFFER } from '@/lib/website-offer';

/**
 * "No website? You get one free." Sits inside a Lite call to action so nobody reads "add Lite to your website" and
 * stops at "I haven't got one". Nothing is bought or asked here: once Lite is added, a card on the Lite pages asks
 * whether they need the website. The gift is in the brand blue and yellow, on navy so it stands out in light and dark.
 *  - `panel`: under the Add Lite button on the Add Lite pages.
 *  - `line`: one sentence at the foot of a card.
 */
export function WebsiteOfferLine({ variant = 'panel' }: { variant?: 'panel' | 'line' }) {
  if (variant === 'line') {
    return (
      <p className="flex items-center gap-2.5 text-[13px] leading-snug text-muted-foreground">
        <GiftBox site={false} className="size-8 shrink-0" />
        <span>
          No website to put it on? A free one-page site is included with Lite, yours to keep after{' '}
          {WEBSITE_OFFER.monthsToKeep} months.
        </span>
      </p>
    );
  }
  return (
    <div className="relative mt-4 overflow-hidden rounded-2xl bg-[#0A1A2E] p-4 text-white shadow-(--look-card-shadow)">
      <span
        aria-hidden
        className="pointer-events-none absolute -top-10 -right-10 size-32 rounded-full border-[16px] border-[#0C66E4]/25"
      />
      <div className="relative flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4">
        <GiftBox className="w-[96px] shrink-0 sm:w-[86px]" />
        <div className="min-w-0">
          <p className="text-[15px] leading-snug font-semibold">No website yet? You get one free.</p>
          <p className="mt-1 text-[12.5px] leading-snug text-white/75">
            A one-page website with Lily on it, built by {WEBSITE_OFFER.builder} and hosted while you&apos;re on Lite. It&apos;s
            yours to keep after {WEBSITE_OFFER.monthsToKeep} months. We&apos;ll ask once you&apos;ve added Lite.
          </p>
          <a
            href={WEBSITE_MORE_PAGES_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-[#F5BC3A] underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-[#F5BC3A] focus-visible:outline-none"
          >
            Need more than one page? Ask Eden
            <ArrowUpRight className="size-3.5" aria-hidden />
          </a>
        </div>
      </div>
    </div>
  );
}
