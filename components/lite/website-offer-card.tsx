'use client';

import { useState } from 'react';
import { ArrowUpRight, Globe, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Notice } from '@/components/look';
import { Button } from '@/components/ui/button';
import { answerWebsiteOffer } from '@/lib/actions/website-offer';
import type { WebsiteCardState } from '@/lib/data/website-offer';
import { WEBSITE_MORE_PAGES_URL, WEBSITE_OFFER } from '@/lib/website-offer';

type Shown = WebsiteCardState | { kind: 'working'; status: 'needs' } | null;

/**
 * The free one-page website, on a paying Lite customer's own Lite pages. Asks once, then says where it has got to.
 * "I've already got one" removes it. Any answer is saved on their account and the owner is emailed on a yes.
 */
export function WebsiteOfferCard({ state }: { state: WebsiteCardState }) {
  const [shown, setShown] = useState<Shown>(state);
  const [saving, setSaving] = useState<'needs' | 'has_one' | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!shown) return null;

  const answer = async (choice: 'needs' | 'has_one') => {
    if (saving) return;
    setError(null);
    setSaving(choice);
    try {
      const result = await answerWebsiteOffer(choice);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.status === 'has_one') {
        toast("Got it. You're all set.");
        setShown(null);
      } else {
        setShown({ kind: 'working', status: 'needs' });
      }
    } catch {
      setError("Couldn't save that. Please try again.");
    } finally {
      setSaving(null);
    }
  };

  if (shown.kind === 'working') {
    return (
      <Notice tone="lite" icon={Globe} title="Your free website is on its way">
        {shown.status === 'needs'
          ? "Thanks. Taylor will be in touch to get your words, photos and colours, then we'll build it."
          : "We're building your one-page website. We'll tell you as soon as it's live."}
      </Notice>
    );
  }

  if (shown.kind === 'live') {
    return (
      <Notice
        tone="lite"
        icon={Globe}
        title="Your free website is live"
        action={
          shown.liveUrl ? (
            <Button asChild variant="outline" className="bg-card">
              <a href={shown.liveUrl} target="_blank" rel="noopener noreferrer">
                Open it
                <ArrowUpRight className="size-4" aria-hidden />
              </a>
            </Button>
          ) : undefined
        }
      >
        It stays up while you&apos;re on Lite. Stay {WEBSITE_OFFER.monthsToKeep} months and it&apos;s yours to keep.
      </Notice>
    );
  }

  return (
    <Notice
      tone="lite"
      icon={Globe}
      title="You get a free one-page website"
      action={
        <div className="flex flex-col gap-2 sm:items-stretch">
          <Button
            type="button"
            disabled={saving !== null}
            onClick={() => void answer('needs')}
            className="bg-(--look-lite-pill) text-white hover:bg-(--look-lite-pill)/90"
          >
            {saving === 'needs' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Yes, build me one
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={saving !== null}
            onClick={() => void answer('has_one')}
            className="bg-card"
          >
            {saving === 'has_one' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            I&apos;ve already got one
          </Button>
        </div>
      }
    >
      Do you need one? If you don&apos;t have a website yet, {WEBSITE_OFFER.builder} will build you a simple one-page site
      with Lily on it, and we&apos;ll host it while you&apos;re on Lite. Stay {WEBSITE_OFFER.monthsToKeep} months and it&apos;s
      yours to keep if you ever leave. Leave sooner and the site comes down. You can cancel Lite any time.{' '}
      <a
        href={WEBSITE_MORE_PAGES_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-(--tone-lite-text) underline-offset-4 hover:underline"
      >
        Need more than one page? Ask Eden
      </a>
      {error ? (
        <span role="alert" className="mt-2 block text-destructive">
          {error}
        </span>
      ) : null}
    </Notice>
  );
}
