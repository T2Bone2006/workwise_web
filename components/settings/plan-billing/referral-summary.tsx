import Link from 'next/link';
import { ChevronRight, Gift } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { referralTotals } from '@/components/referrals/referral-utils';
import { formatPence } from '@/lib/billing/plans';
import type { ReferralData } from '@/lib/data/referral-page';

/** Plan & billing keeps a short summary; the link, list and how it works live on /refer. */
export function ReferralSummary({ referral }: { referral: ReferralData }) {
  const { joined, earned, creditedPence } = referralTotals(referral.referrals);
  const line =
    joined === 0
      ? `Send another trader your link. When they've paid their first full month, ${formatPence(referral.myMonthlyPence)} comes off your next bill.`
      : `${joined} joined · ${earned} free ${earned === 1 ? 'month' : 'months'} earned · ${formatPence(creditedPence)} credited`;

  return (
    <section aria-labelledby="referral-heading">
      <h2 id="referral-heading" className="text-sm font-semibold">
        Referrals
      </h2>
      <div className="mt-3 flex flex-col gap-4 rounded-2xl border border-(--tone-emerald-line) bg-(--tone-emerald-soft) p-4 sm:flex-row sm:items-center sm:gap-5 sm:p-5">
        <div className="flex min-w-0 flex-1 items-start gap-3.5">
          <span
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-(--look-green-pill) text-white"
            aria-hidden
          >
            <Gift className="size-[18px]" />
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-card-foreground">Give a month, get a month</p>
            <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">{line}</p>
          </div>
        </div>
        <Button
          asChild
          className="h-10 rounded-xl bg-(--look-green-pill) px-4 font-semibold text-white hover:bg-(--look-green-pill)/90 sm:shrink-0"
        >
          <Link href="/refer">
            Open referrals
            <ChevronRight className="size-4 opacity-80" aria-hidden />
          </Link>
        </Button>
      </div>
    </section>
  );
}
