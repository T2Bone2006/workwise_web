import { formatGbp } from '@/lib/money/pence';
import type { Ymd } from '@/lib/rounds/dates';

/** '2027-03-12' → '12 Mar'. */
export function formatShortDay(ymd: Ymd | null): string {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

export function formatMoney(amount: number | null): string {
  return amount == null ? '' : formatGbp(amount, { always2dp: true });
}
