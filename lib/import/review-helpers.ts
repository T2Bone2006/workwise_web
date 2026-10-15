/** Pure helpers for the Rounds import review screen. */

import {
  type PreparedCustomerRow,
  isImportableCustomerRow,
} from '@/lib/import/extracted-customer-row';
import { addDays, type Ymd } from '@/lib/rounds/dates';
import { firstOccurrenceOnOrAfter } from '@/lib/rounds/recurrence';
import { nameKey } from '@/lib/rounds/import-plan';

function addressKey(address: string): string {
  return address.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14);
}

/**
 * Rows that look like a repeat of an earlier row (same person, same postcode,
 * same start of address). Returns rowIndex → the earlier rowIndex. A second
 * address for the same person is not a repeat; skipped rows never count.
 */
export function findRepeatRows(rows: PreparedCustomerRow[]): Map<number, number> {
  const seen = new Map<string, number>();
  const repeats = new Map<number, number>();
  for (const row of rows) {
    if (row.status === 'skip' || !row.name || !row.postcode) continue;
    const key = `${nameKey(row.name)}|${row.postcode}|${addressKey(row.address)}`;
    const first = seen.get(key);
    if (first === undefined) seen.set(key, row.rowIndex);
    else repeats.set(row.rowIndex, first);
  }
  return repeats;
}

export type NextVisitSource = 'sheet' | 'from-last-visit' | 'default' | 'today';

/** When the first visit will land, using the same order the save step uses. */
export function effectiveNextVisit(
  row: PreparedCustomerRow,
  defaultStart: Ymd | null,
  today: Ymd
): { date: Ymd; source: NextVisitSource } {
  if (row.nextVisitDate) return { date: row.nextVisitDate, source: 'sheet' };
  if (row.lastVisitDate && row.frequencyDays) {
    return {
      date: firstOccurrenceOnOrAfter(row.lastVisitDate, row.frequencyDays, today),
      source: 'from-last-visit',
    };
  }
  if (defaultStart) return { date: defaultStart, source: 'default' };
  return { date: addDays(today, 0), source: 'today' };
}

/** Money owed from before across the rows that would be imported. */
export function owedFromBefore(rows: PreparedCustomerRow[]): { total: number; customers: number } {
  let total = 0;
  let customers = 0;
  for (const row of rows) {
    if (!isImportableCustomerRow(row) || row.balanceOwed == null) continue;
    total += row.balanceOwed;
    customers += 1;
  }
  return { total: Math.round(total * 100) / 100, customers };
}
