import { formatPoundsLong } from '@/lib/billing/pro-plans';
import { formatDayMonth } from './referral-utils';

/** What the share buttons send. Promises the friend nothing (D3: no discount for Pro). */
export function proShareMessage(link: string): string {
  return `I run my team on WorkWise Pro. Have a look: ${link}`;
}

export function proReferralStatus(row: {
  status: 'waiting' | 'rewarding' | 'rewarded' | 'void';
  rewardPence: number | null;
  rewardedAt: string | null;
}): { label: string; tone: 'emerald' | 'amber' | 'slate' } {
  if (row.status === 'rewarded') {
    const when = formatDayMonth(row.rewardedAt);
    const amount = typeof row.rewardPence === 'number' && row.rewardPence > 0 ? `${formatPoundsLong(row.rewardPence)} credit` : 'Credit';
    return { label: when ? `${amount} added ${when}` : `${amount} added`, tone: 'emerald' };
  }
  if (row.status === 'void') return { label: "Didn't qualify", tone: 'slate' };
  return { label: 'Waiting for their payments', tone: 'amber' };
}

export function proHowItWorks(myMonthlyPence: number): Array<{ title: string; text: string }> {
  return [
    { title: 'Share your link', text: 'Send it to another trade business, or give them your code.' },
    {
      title: 'They sign up and pay the normal price',
      text: "There's no discount for them: they choose a plan, add their team and pay as usual.",
    },
    {
      title: "Once they're settled in, you're credited",
      text: "When they've paid their third monthly bill, or their first yearly payment, we add a credit to your account.",
    },
    {
      title: 'One month of the cheaper plan',
      text: `The credit is one month of the cheaper of your plan and theirs, up to ${formatPoundsLong(myMonthlyPence)}, taken off your next bill. Rounds and Lite businesses count too.`,
    },
  ];
}

/** Sum of the credit actually added. */
export function creditEarnedPence(rows: Array<{ status: string; rewardPence: number | null }>): number {
  return rows.reduce((sum, row) => (row.status === 'rewarded' ? sum + (row.rewardPence ?? 0) : sum), 0);
}

export const PRO_SIDEBAR_WORDING = {
  title: 'Refer a business',
  line: "Earn a month's credit",
  collapsed: "Refer a business: earn a month's credit",
} as const;
