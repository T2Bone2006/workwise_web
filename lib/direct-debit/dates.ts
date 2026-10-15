import { addDays, isoWeekday, type Ymd } from '@/lib/rounds/dates';

/** Adds n working days (Mon–Fri). Weekends only — WorkWise has no bank-holiday list. */
export function addWorkingDays(ymd: Ymd, n: number): Ymd {
  let date = ymd;
  let left = Math.max(0, Math.floor(n));
  while (left > 0) {
    date = addDays(date, 1);
    if (isoWeekday(date) <= 5) left -= 1;
  }
  return date;
}

/**
 * Earliest date the customer's bank is debited for a collection made this
 * evening: +3 working days (active Direct Debit), +5 (pending).
 */
export function directDebitCollectOn(todayYmd: Ymd, status: 'active' | 'pending'): Ymd {
  return addWorkingDays(todayYmd, status === 'active' ? 3 : 5);
}
