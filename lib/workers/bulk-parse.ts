import { z } from 'zod';
import { normalizeUkPostcode } from '@/lib/utils/postcode';

/**
 * Bulk add: turn pasted text (Excel / Sheets paste is tab separated) or a CSV into rows, and check each row.
 * Pure (no database, no server-only), so the screen runs the same rules live and the server runs them again.
 */

export const BULK_MAX_ROWS = 100;
export const BULK_CHUNK_SIZE = 10;

export type BulkRowInput = { name: string; phone: string; postcode: string; email: string };

export type BulkRow = BulkRowInput & {
  /** 1-based position among the pasted rows (after any header). */
  line: number;
  /** Normalised values when the row is valid. */
  clean?: { name: string; phone: string; postcode: string; email: string };
  /** Plain-English problems; empty = the row is fine. */
  errors: string[];
};

type Column = 'name' | 'phone' | 'postcode' | 'email';

/** A small CSV reader: quoted fields may contain the delimiter, doubled quotes and line breaks. */
function readRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => {
    record.push(field);
    field = '';
  };
  const pushRecord = () => {
    pushField();
    records.push(record);
    record = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
    } else if (ch === delimiter) {
      pushField();
    } else if (ch === '\n') {
      pushRecord();
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field !== '' || record.length > 0) pushRecord();
  return records;
}

function pickDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  if (firstLine.includes('\t')) return '\t';
  const commas = (firstLine.match(/,/g) ?? []).length;
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  if (semicolons > commas) return ';';
  return ',';
}

function columnFor(header: string): Column | null {
  const h = header.trim().toLowerCase().replace(/[^a-z ]/g, '');
  if (!h) return null;
  if (/post\s*code|zip/.test(h)) return 'postcode';
  if (/e\s*-?\s*mail/.test(h)) return 'email';
  if (/phone|mobile|tel|number/.test(h)) return 'phone';
  if (/name/.test(h)) return 'name';
  return null;
}

/**
 * Splits pasted text or CSV into rows. A first line with at least two recognisable headings (name, phone,
 * postcode, email, in any order) is a header and the columns are matched by it; otherwise they are read in the
 * order name, phone, postcode, email. Blank lines are skipped. More than BULK_MAX_ROWS rows keeps the first
 * BULK_MAX_ROWS and sets `truncated`.
 */
export function parseBulkWorkers(text: string): { rows: BulkRow[]; truncated: boolean; unknownHeaders: string[] } {
  const clean = text.replace(/^﻿/, '');
  if (clean.trim() === '') return { rows: [], truncated: false, unknownHeaders: [] };

  const records = readRecords(clean, pickDelimiter(clean)).filter((r) => r.some((c) => c.trim() !== ''));
  if (records.length === 0) return { rows: [], truncated: false, unknownHeaders: [] };

  const order: Column[] = ['name', 'phone', 'postcode', 'email'];
  let map: Array<Column | null> = order;
  let unknownHeaders: string[] = [];
  let dataStart = 0;

  const headerGuess = records[0].map(columnFor);
  const recognised = new Set(headerGuess.filter((c): c is Column => c !== null));
  if (recognised.size >= 2) {
    map = headerGuess;
    unknownHeaders = records[0].filter((cell, i) => headerGuess[i] === null && cell.trim() !== '').map((c) => c.trim());
    dataStart = 1;
  }

  const dataRecords = records.slice(dataStart);
  const truncated = dataRecords.length > BULK_MAX_ROWS;
  const rows: BulkRow[] = dataRecords.slice(0, BULK_MAX_ROWS).map((record, i) => {
    const row: BulkRowInput = { name: '', phone: '', postcode: '', email: '' };
    record.forEach((cell, col) => {
      const target = map[col];
      if (target && row[target] === '') row[target] = cell.trim();
    });
    return { ...row, line: i + 1, errors: [] };
  });
  return { rows, truncated, unknownHeaders };
}

const emailSchema = z.string().email();
const PHONE_RE = /^(\+44|0)[0-9]{10,13}$/;

/** Excel drops the leading 0 of a mobile number; a bare 10-digit number starting with 7 gets it back. */
function normalisePhone(raw: string): string | null {
  const compact = raw.replace(/[\s\-().]/g, '');
  if (/^7\d{9}$/.test(compact)) return `0${compact}`;
  if (/^447\d{9}$/.test(compact)) return `+${compact}`;
  return PHONE_RE.test(compact) ? compact : null;
}

/**
 * Checks every row with the same rules as the single-worker form (name 2–100 characters, UK phone, UK postcode,
 * valid email: it is how they get their login) and marks a repeated email or phone inside the batch. Returns new rows; the input is not changed.
 */
export function validateBulkRows(rows: ReadonlyArray<BulkRow>): BulkRow[] {
  const seenEmail = new Map<string, number>();
  const seenPhone = new Map<string, number>();

  return rows.map((row) => {
    const errors: string[] = [];
    const name = row.name.trim();
    const email = row.email.trim().toLowerCase();
    const phone = normalisePhone(row.phone);
    const postcode = normalizeUkPostcode(row.postcode);

    if (name.length < 2 || name.length > 100) errors.push('Needs a name');
    if (!phone) errors.push("Phone number doesn't look right");
    if (!postcode) errors.push("Postcode doesn't look right");
    if (!email) errors.push('Needs an email so they can log in');
    else if (!emailSchema.safeParse(email).success) errors.push("Email doesn't look right");

    if (email && errors.every((e) => e !== "Email doesn't look right")) {
      const first = seenEmail.get(email);
      if (first !== undefined) errors.push(`Same email as line ${first}`);
      else seenEmail.set(email, row.line);
    }
    if (phone) {
      const first = seenPhone.get(phone);
      if (first !== undefined) errors.push(`Same phone number as line ${first}`);
      else seenPhone.set(phone, row.line);
    }

    const valid = errors.length === 0 && phone && postcode;
    return {
      ...row,
      errors,
      clean: valid ? { name, phone: phone as string, postcode: postcode as string, email } : undefined,
    };
  });
}
