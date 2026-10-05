import { SIDE_COLOUR } from '@/components/auth/auth-side-panel';
import type { SignupOfferView } from '@/lib/billing/offers';
import { formatPence, PLANS, type PlanChoice } from '@/lib/billing/plans';

/** What happens to their card, worded from the offer the server would apply. */
export function chargeLine(choice: PlanChoice, offer: SignupOfferView): string {
  const { month, year } = PLANS[choice.plan].pence;
  if (offer === 'founding') {
    const half = formatPence(Math.round(month / 2));
    return `${half} today, ${half} next month, then ${formatPence(month)} a month.`;
  }
  if (offer === 'free_then_half') {
    const half = formatPence(Math.round(month / 2));
    return `£0 today. Your first month is free, ${half} next month, then ${formatPence(month)} a month.`;
  }
  if (offer === 'free_month') {
    return `£0 today. Your first month is free, then ${formatPence(month)} a month.`;
  }
  if (offer === 'month_off_year') {
    return `${formatPence(year - month)} today, then ${formatPence(year)} a year.`;
  }
  const price = formatPence(PLANS[choice.plan].pence[choice.interval]);
  return `${price} today, then ${price} ${choice.interval === 'month' ? 'a month' : 'a year'}.`;
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
        Cancel any time from Settings. Prices include VAT where applicable.
      </p>
    </section>
  );
}
