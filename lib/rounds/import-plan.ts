/**
 * Pure planning helpers for the Rounds customer import (matching rules).
 * The save step builds on these; the review screen uses `nameKey` to spot repeats.
 */

import type { PreparedCustomerRow } from '@/lib/import/extracted-customer-row';
import type { Ymd } from '@/lib/rounds/dates';
import { isValidYmd } from '@/lib/rounds/dates';
import { firstOccurrenceOnOrAfter } from '@/lib/rounds/recurrence';

const TITLES = /^(mr|mrs|ms|miss|mx|dr|prof)\b\.?\s*/i;

/** lower, trimmed, collapsed spaces, with titles and punctuation dropped — "Mrs. P  Okafor" → "p okafor". */
export function nameKey(name: string): string {
  let s = name.toLowerCase().replace(/&/g, ' and ');
  // A leading title, and "mr and mrs" style pairs, are noise for matching.
  s = s.replace(/\b(mr|mrs|ms|miss|mx|dr|prof)\b\.?/g, ' ');
  s = s.replace(TITLES, '');
  s = s.replace(/[^a-z0-9\s]/g, ' ');
  // "Mr & Mrs Henderson" leaves a stray leading "and" once the titles are gone.
  return s.replace(/\s+/g, ' ').trim().replace(/^and /, '');
}

/** What we store as the agreement title. A blank or one-letter service becomes "Regular visit". */
export function agreementTitle(service: string): string {
  const trimmed = service.trim().replace(/\s+/g, ' ');
  return trimmed.length >= 2 ? trimmed.slice(0, 120) : 'Regular visit';
}

/** Lowered agreement title, for "same service at this postcode" skips. */
export function titleKey(title: string): string {
  const s = title.trim().toLowerCase().replace(/\s+/g, ' ');
  return s || 'regular visit';
}

export function postcodeKey(postcode: string): string {
  return postcode.replace(/\s+/g, '').toUpperCase();
}

export type ImportExisting = {
  customers: Array<{ id: string; nameKey: string; postcodes: string[] }>;
  agreements: Array<{ customerId: string; titleKey: string; postcode: string; status: string }>;
};

export type ImportRowPlan = {
  customer: { matchId: string } | { create: true };
  agreement: 'create' | 'skip_existing';
  anchorDate: Ymd;
  /** Pounds to record as owed-from-before. Only set when this row creates the customer. */
  balance: number | null;
  pause: boolean;
};

/**
 * Next visit on the sheet, else one interval after the last visit, else today.
 * A default start date is written onto `nextVisitDate` by the review screen
 * before this runs, so it takes the first branch.
 */
function chooseAnchor(row: PreparedCustomerRow, today: Ymd): Ymd {
  if (row.nextVisitDate && isValidYmd(row.nextVisitDate)) return row.nextVisitDate;
  if (row.lastVisitDate && isValidYmd(row.lastVisitDate) && row.frequencyDays && row.frequencyDays >= 1) {
    return firstOccurrenceOnOrAfter(row.lastVisitDate, row.frequencyDays, today);
  }
  return today;
}

/**
 * Match a customer when the name and postcode already belong together.
 * One person already on the round, at a second address, is the same customer
 * (only one name match). Two people who already share a name stay separate:
 * a row joins the one at that postcode, and a postcode neither of them uses
 * is a new customer.
 */
export function planImportRow(row: PreparedCustomerRow, existing: ImportExisting, today: Ymd): ImportRowPlan {
  const key = nameKey(row.name);
  const pc = postcodeKey(row.postcode);
  const sameName = existing.customers.filter((c) => c.nameKey === key && key !== '');
  const byPostcode = pc
    ? sameName.filter((c) => c.postcodes.some((p) => postcodeKey(p) === pc))
    : [];

  const customer: ImportRowPlan['customer'] =
    byPostcode.length > 0
      ? { matchId: byPostcode[0]!.id }
      : sameName.length === 1
        ? { matchId: sameName[0]!.id }
        : { create: true };

  const customerId = 'matchId' in customer ? customer.matchId : null;
  const serviceKey = titleKey(agreementTitle(row.service));
  const agreement: ImportRowPlan['agreement'] =
    customerId &&
    existing.agreements.some(
      (a) => a.customerId === customerId && a.titleKey === serviceKey && postcodeKey(a.postcode) === pc,
    )
      ? 'skip_existing'
      : 'create';

  const balance =
    'create' in customer && customer.create && row.balanceOwed != null && row.balanceOwed > 0
      ? row.balanceOwed
      : null;

  return {
    customer,
    agreement,
    anchorDate: chooseAnchor(row, today),
    balance,
    pause: row.status === 'paused',
  };
}
