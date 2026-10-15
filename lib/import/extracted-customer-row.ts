/**
 * Customer-row import: shared types + deterministic validation (Rounds).
 * Pure helpers (safe for client + server); the AI call lives in
 * extract-customer-rows.ts and read-round-book.ts.
 *
 * Same contract as the Pro job import: the AI proposes one customer per row,
 * seeing every column at once, and these validators dispose. Nothing the
 * model returns reaches the database without passing the checks below, and
 * the review screen shows exactly what these checks decide.
 */

import { z } from 'zod';
import { collectSourceFields } from '@/lib/import/extracted-job-row';
import { parseScheduledDate } from '@/lib/import/parse-scheduled-date';
import { addDays, compareYmd, todayInLondon, type Ymd } from '@/lib/rounds/dates';
import { parseFrequencyDays } from '@/lib/rounds/parse-frequency';
import { normalizeUkPhoneE164 } from '@/lib/utils/phone';
import { resolvePostcodeDeterministic } from '@/lib/utils/postcode';

/** What the model must return per row. Empty string = not present in the sheet. */
export const ExtractedCustomerRowSchema = z.object({
  row_index: z.number().int().describe('The 0-based index of the source row, copied from the input'),
  is_customer_row: z
    .boolean()
    .describe('false for a totals row, heading, note or anything that is not one customer'),
  name: z.string(),
  phone: z.string(),
  email: z.string(),
  address: z.string().describe('Street address without the postcode'),
  postcode: z.string(),
  service: z.string().describe('What is done, e.g. "Windows". "" if not stated'),
  price: z.string().describe('Price per visit as a plain number, e.g. "12.50". "" if absent'),
  frequency: z.string().describe('How often, e.g. "4 weeks", "monthly". "" if absent'),
  preferred_weekday: z.string().describe('Day of the week they are usually done, e.g. "Thursday". "" if absent'),
  last_visit_date: z.string().describe('YYYY-MM-DD, or "" when not a full date'),
  next_visit_date: z.string().describe('YYYY-MM-DD, or "" when not a full date'),
  balance_owed: z.string().describe('Money they owed on the old system, e.g. "12.50". "" if none or a credit'),
  status: z.string().describe('"paused", "cancelled" or ""'),
  access_notes: z.string().describe('Gate codes, dogs, where to leave things, how to get in'),
  notes: z.string().describe('Anything else worth keeping'),
});

export const CustomerExtractionBatchSchema = z.object({
  customers: z.array(ExtractedCustomerRowSchema),
});

export type ExtractedCustomerRow = z.infer<typeof ExtractedCustomerRowSchema>;

/** Rows per AI call for the Rounds customer import. */
export const CUSTOMER_EXTRACTION_BATCH_SIZE = 10;

/** Marker on a row we could not read at all (a failed batch). See `blankExtractedCustomerRow`. */
export const UNREAD_ROW_STATUS = '__unread__';

export type CustomerRowStatus = 'active' | 'paused' | 'skip';

/** One row after AI extraction + deterministic validation. Drives the review table. */
export type PreparedCustomerRow = {
  rowIndex: number;
  /** No red problems. A skipped row is never validated, so it is always ok. */
  ok: boolean;
  errors: string[];
  /** Which cells the errors are about, so the review table can open exactly those for editing. */
  errorFields: EditableCustomerField[];
  /** Amber, never blocks an import: "check this", "left out". */
  warnings: string[];
  name: string;
  /** What to show in the phone cell (cleaned); '' when absent. */
  phone: string;
  phoneE164: string | null;
  rawPhone: string;
  /** '' when absent or not a plausible email (then a warning explains). */
  email: string;
  address: string;
  /** Normalised UK postcode, or '' when unresolved. */
  postcode: string;
  rawPostcode: string;
  service: string;
  price: number | null;
  rawPrice: string;
  frequencyDays: number | null;
  rawFrequency: string;
  /** ISO weekday 1 (Mon) – 7 (Sun). */
  preferredWeekday: number | null;
  lastVisitDate: Ymd | null;
  nextVisitDate: Ymd | null;
  rawNextVisitDate: string;
  accessNotes: string;
  notes: string;
  /** Money owed from the old system; null when none (never negative). */
  balanceOwed: number | null;
  rawBalance: string;
  /** 'skip' = cancelled or not a customer: shown greyed, never imported. */
  status: CustomerRowStatus;
  skipReason: string | null;
  /** Every non-empty spreadsheet column, for "what we read". */
  sourceFields: Record<string, string>;
};

/** Fields a person may correct inline on a review row. */
export type EditableCustomerField =
  | 'name'
  | 'phone'
  | 'email'
  | 'address'
  | 'postcode'
  | 'service'
  | 'price'
  | 'frequency'
  | 'nextVisitDate'
  | 'balanceOwed'
  | 'status';

export type CustomerRowEdits = Partial<Record<EditableCustomerField, string>>;

export type CustomerImportDefaults = { frequencyDays?: number | null; price?: number | null };

export const UNREADABLE_ROW_MESSAGE = "Couldn't read this row — fill it in";
export const CANCELLED_MESSAGE = "Cancelled in your old system — won't be imported";
export const NOT_A_CUSTOMER_MESSAGE = "Doesn't look like a customer (a total or heading row) — won't be imported";

const MAX_BALANCE = 10_000;
const HIGH_PRICE_WARNING = 100;

/**
 * Placeholder for a row we could not read — a model that skipped it, or a
 * batch whose AI call failed. Always fails validation, so it shows up red in
 * the review table instead of silently vanishing from the import.
 */
export function blankExtractedCustomerRow(rowIndex: number): ExtractedCustomerRow {
  return {
    row_index: rowIndex,
    is_customer_row: true,
    name: '',
    phone: '',
    email: '',
    address: '',
    postcode: '',
    service: '',
    price: '',
    frequency: '',
    preferred_weekday: '',
    last_visit_date: '',
    next_visit_date: '',
    balance_owed: '',
    status: UNREAD_ROW_STATUS,
    access_notes: '',
    notes: '',
  };
}

/** "£12.50", "12.5", "£1,234.50", "12 per visit" → 12.5 etc. null when not a plain amount. */
export function parseMoneyAmount(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const cleaned = String(raw)
    .trim()
    .toLowerCase()
    .replace(/£/g, '')
    .replace(/\b(per visit|a visit|each|pv|p\/v)\b/g, '')
    .replace(/,/g, '')
    .trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

const WEEKDAYS: Record<string, number> = {
  mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6, sun: 7, sunday: 7,
};

export function parseWeekday(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const word = raw.trim().toLowerCase().replace(/s$/, '').replace(/[^a-z]/g, '');
  return WEEKDAYS[word] ?? null;
}

/** Free-text status from a sheet (or an edit) → the three states we use. */
export function parseCustomerStatus(raw: string | null | undefined): CustomerRowStatus {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return 'active';
  if (/(cancel|left|ended|moved|stopped|deceased|no longer|skip|don'?t import)/.test(s)) return 'skip';
  if (/(paus|hold|holiday|suspend)/.test(s)) return 'paused';
  return 'active';
}

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** 7700 900444 (leading 0 lost in the spreadsheet) still gets read as a mobile. */
function readPhone(raw: string): string | null {
  const direct = normalizeUkPhoneE164(raw);
  if (direct) return direct;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('7')) return normalizeUkPhoneE164(`0${digits}`);
  return null;
}

/** Take the postcode out of the end of an address, in case the sheet repeated it. */
function stripPostcodeFromAddress(address: string, postcode: string): string {
  if (!postcode || !address) return address.trim();
  const [outward, inward] = postcode.split(' ');
  if (!outward || !inward) return address.trim();
  const re = new RegExp(`[,\\s]*${outward}\\s*${inward}\\s*$`, 'i');
  return address.replace(re, '').replace(/[,\s]+$/, '').trim();
}

/**
 * Validate one AI-extracted row. `edits` are corrections made in the review
 * table and win over the AI's values. `defaults` fill a missing frequency or
 * price. Skipped rows (cancelled / not a customer) are not validated.
 */
export function prepareExtractedCustomerRow(
  extracted: ExtractedCustomerRow,
  rawRow: Record<string, string>,
  edits: CustomerRowEdits = {},
  defaults: CustomerImportDefaults = {},
  today: Ymd = todayInLondon()
): PreparedCustomerRow {
  const errors: string[] = [];
  const errorFields = new Set<EditableCustomerField>();
  const warnings: string[] = [];
  const fail = (field: EditableCustomerField, message: string) => {
    errors.push(message);
    errorFields.add(field);
  };

  const isUnread = extracted.status === UNREAD_ROW_STATUS;
  const name = (edits.name ?? extracted.name ?? '').trim();
  const rawPhone = (edits.phone ?? extracted.phone ?? '').trim();
  const rawEmail = (edits.email ?? extracted.email ?? '').trim();
  const addressRaw = (edits.address ?? extracted.address ?? '').trim();
  const rawPostcode = (edits.postcode ?? extracted.postcode ?? '').trim();
  const service = (edits.service ?? extracted.service ?? '').trim();
  const rawPrice = (edits.price ?? extracted.price ?? '').trim();
  const rawFrequency = (edits.frequency ?? extracted.frequency ?? '').trim();
  const rawNextVisitDate = (edits.nextVisitDate ?? extracted.next_visit_date ?? '').trim();
  const rawLastVisit = (extracted.last_visit_date ?? '').trim();
  const rawBalance = (edits.balanceOwed ?? extracted.balance_owed ?? '').trim();
  const sourceFields = collectSourceFields(rawRow);

  // Status: an edit wins; otherwise the sheet's wording; a non-customer row is skipped.
  let status: CustomerRowStatus;
  let skipReason: string | null = null;
  if (edits.status !== undefined) {
    status = parseCustomerStatus(edits.status);
  } else if (extracted.is_customer_row === false) {
    status = 'skip';
    skipReason = NOT_A_CUSTOMER_MESSAGE;
  } else {
    status = isUnread ? 'active' : parseCustomerStatus(extracted.status);
  }
  if (status === 'skip' && !skipReason) skipReason = CANCELLED_MESSAGE;

  const postcode = resolvePostcodeDeterministic(rawPostcode, addressRaw) ?? '';
  const address = stripPostcodeFromAddress(addressRaw, postcode);

  const base = {
    rowIndex: extracted.row_index,
    name,
    rawPhone,
    address,
    postcode,
    rawPostcode,
    service,
    rawPrice,
    rawFrequency,
    rawNextVisitDate,
    rawBalance,
    accessNotes: (extracted.access_notes ?? '').trim(),
    notes: (extracted.notes ?? '').trim(),
    status,
    skipReason,
    sourceFields,
  };

  if (status === 'skip') {
    return {
      ...base,
      ok: true,
      errors: [],
      errorFields: [],
      warnings: [],
      phone: rawPhone,
      phoneE164: null,
      email: rawEmail,
      price: null,
      frequencyDays: null,
      preferredWeekday: null,
      lastVisitDate: null,
      nextVisitDate: null,
      balanceOwed: null,
    };
  }

  if (!name) fail('name', isUnread ? UNREADABLE_ROW_MESSAGE : 'Missing name');
  if (!address) fail('address', 'Missing address');
  if (!postcode) {
    fail('postcode', rawPostcode ? `Invalid postcode "${rawPostcode}"` : 'Missing postcode (none found in the row)');
  }

  // Price: a number when the sheet gave one; the default fills a blank.
  let price: number | null = null;
  if (rawPrice) {
    price = parseMoneyAmount(rawPrice);
    if (price == null) fail('price', `Couldn't read the price "${rawPrice}"`);
    else if (price > 100000) {
      price = null;
      fail('price', 'Check this price');
    } else if (price >= HIGH_PRICE_WARNING) warnings.push(`£${price} a visit is high — check it`);
  } else if (defaults.price != null && defaults.price >= 0) {
    price = defaults.price;
  } else {
    fail('price', 'No price — type one or set a default price below');
  }

  // Frequency: same rule.
  let frequencyDays: number | null = null;
  if (rawFrequency) {
    frequencyDays = parseFrequencyDays(rawFrequency);
    if (frequencyDays == null) fail('frequency', `Couldn't read how often "${rawFrequency}" — try "4 weeks"`);
  } else if (defaults.frequencyDays != null) {
    frequencyDays = defaults.frequencyDays;
  } else {
    fail('frequency', 'No frequency — type one or set a default below');
  }

  // Dates: next wins over last; a date the sheet gave that we can't read is red.
  let nextVisitDate: Ymd | null = null;
  if (rawNextVisitDate) {
    nextVisitDate = parseScheduledDate(rawNextVisitDate);
    if (!nextVisitDate) fail('nextVisitDate', `Couldn't read the next visit date "${rawNextVisitDate}"`);
    else if (compareYmd(nextVisitDate, addDays(today, -365)) < 0) {
      fail('nextVisitDate', 'Next visit is more than a year ago — check the date');
    }
  }
  let lastVisitDate: Ymd | null = null;
  if (rawLastVisit) {
    lastVisitDate = parseScheduledDate(rawLastVisit);
    if (!lastVisitDate) warnings.push(`Couldn't read the last visit "${rawLastVisit}" — left out`);
  }

  // Balance: money owed, never negative, never huge.
  let balanceOwed: number | null = null;
  if (rawBalance && !/(credit|^-)/i.test(rawBalance)) {
    const amount = parseMoneyAmount(rawBalance);
    if (amount == null) fail('balanceOwed', `Couldn't read what they owe "${rawBalance}"`);
    else if (amount > MAX_BALANCE) fail('balanceOwed', 'Check this amount owed');
    else balanceOwed = amount > 0 ? amount : null;
  }

  // Contact: a bad phone or email never blocks the row, it is left out with a note.
  let phoneE164: string | null = null;
  if (rawPhone) {
    phoneE164 = readPhone(rawPhone);
    if (!phoneE164) warnings.push(`Phone "${rawPhone}" doesn't look like a UK number`);
  }
  let email = '';
  if (rawEmail) {
    if (EMAIL_RE.test(rawEmail)) email = rawEmail.toLowerCase();
    else warnings.push(`Email "${rawEmail}" doesn't look right — left out`);
  }

  return {
    ...base,
    ok: errors.length === 0,
    errors,
    errorFields: [...errorFields],
    warnings,
    phone: phoneE164 ?? rawPhone,
    phoneE164,
    email,
    price,
    frequencyDays,
    preferredWeekday: parseWeekday(extracted.preferred_weekday),
    lastVisitDate,
    nextVisitDate,
    balanceOwed,
  };
}

/** Is this row going to be written when Import is pressed? */
export function isImportableCustomerRow(row: PreparedCustomerRow): boolean {
  return row.ok && row.status !== 'skip';
}

export function summariseCustomerRows(rows: PreparedCustomerRow[]): {
  ready: number;
  toFix: number;
  skipped: number;
} {
  let ready = 0;
  let toFix = 0;
  let skipped = 0;
  for (const row of rows) {
    if (row.status === 'skip') skipped += 1;
    else if (row.ok) ready += 1;
    else toFix += 1;
  }
  return { ready, toFix, skipped };
}
