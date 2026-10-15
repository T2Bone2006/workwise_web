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

/** What the friend gets. Founding active or unknown: first month free, second half price. */
export function friendOfferLine(foundingActive: boolean | null): string {
  return foundingActive === false
    ? 'They get their first month free (or a month off if they go yearly).'
    : 'They get their first month free and their second at half price (or a month off if they go yearly).';
}
