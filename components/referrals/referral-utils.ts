import type { ReferralRow } from '@/lib/billing/referrals';

/** `5 Oct`: day and short month, no year. */
export function formatDayMonth(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' }).format(date);
}

export function referralTotals(referrals: ReferralRow[]) {
  const rewarded = referrals.filter((row) => row.status === 'rewarded');
  return {
    joined: referrals.length,
    earned: rewarded.length,
    creditedPence: rewarded.reduce((sum, row) => sum + (row.rewardPence ?? 0), 0),
    waiting: referrals.filter((row) => row.status === 'waiting' || row.status === 'rewarding').length,
  };
}

/** What the friend gets: a 60-day free trial instead of 30. */
export function friendOfferLine(_foundingActive?: boolean | null): string {
  return 'They get 60 days free instead of 30, then pay as normal.';
}
