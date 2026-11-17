import { SIDE_COLOUR } from '@/components/auth/auth-side-panel';
import type { SignupOfferView } from '@/lib/billing/offers';
import { formatPence, PLANS, REFERRED_TRIAL_DAYS, TRIAL_DAYS, type PlanChoice } from '@/lib/billing/plans';

/** What happens to their card, worded from the offer the server would apply. */
export function chargeLine(choice: PlanChoice, offer: SignupOfferView): string {
  const list = PLANS[choice.plan].pence[choice.interval];
  const period = choice.interval === 'month' ? 'a month' : 'a year';
  const days = offer === 'referred' || offer === 'founder_referred' ? REFERRED_TRIAL_DAYS : TRIAL_DAYS;
  if (offer === 'founder' || offer === 'founder_referred') {
    return `£0 today. ${days} days free, then ${formatPence(Math.round(list / 2))} ${period} for life.`;
  }
  return `£0 today. ${days} days free, then ${formatPence(list)} ${period}.`;
}

/** "What you'll pay" beside the details form. Display only; the server recomputes at submit. */
export function SignupSummary({ choice, offer }: { choice: PlanChoice; offer: SignupOfferView }) {
  return (
    <section
      aria-label="What you'll pay"
      className="relative overflow-hidden rounded-2xl bg-[#F5F7FB] p-4 pl-5 dark:bg-white/[0.04]"
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-1.5" style={{ background: SIDE_COLOUR[choice.plan] }} />
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-semibold text-[#3D4A5C] dark:text-[#C3CEDD]">What you&apos;ll pay</h2>
        <p className="text-[13px] font-medium text-[#5E6B7D] dark:text-[#A9B6C8]">
          {PLANS[choice.plan].label}, {choice.interval === 'month' ? 'monthly' : 'yearly'}
        </p>
      </div>
      <p className="mt-2 text-pretty text-[17px] font-semibold leading-snug tracking-[-0.01em] text-[#0A1A2E] dark:text-[#EAF1FB]">
        {chargeLine(choice, offer)}
      </p>
      <p className="mt-2 text-[13px] leading-relaxed text-[#5E6B7D] dark:text-[#A9B6C8]">
        Your card is only charged when the free trial ends. Cancel any time before then from Settings and you pay nothing.
      </p>
    </section>
  );
}
