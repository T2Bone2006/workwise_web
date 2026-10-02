import { currentTaxYear, parsePeriodParam, periodParam, type Period } from '@/lib/books/periods';
import type { Ymd } from '@/lib/rounds/dates';

/** Accountants work by tax year, so with no ?period= the pages open on this tax year. */
export function accountantPeriod(raw: string | undefined, today: Ymd): Period {
  return raw ? parsePeriodParam(raw, today) : currentTaxYear(today);
}

export { periodParam };
