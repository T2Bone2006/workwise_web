// Pure: spreadsheets for accountants. RFC 4180 quoting, a BOM so Excel shows £ and accents,
// and a guard against spreadsheet formula injection.

export type CsvCell = string | number | null | undefined;

const BOM = '﻿';

/** A text cell that a spreadsheet could read as a formula gets a leading ' so it stays text. */
function guard(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function cell(value: CsvCell): string {
  if (value == null) return '';
  // Numbers are real numbers (a negative stays -5.00); only text is guarded.
  const text = typeof value === 'number' ? (Number.isFinite(value) ? value.toFixed(2) : '') : guard(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Whole numbers (a count, a day) as a plain number, not 3.00. */
export function whole(n: number): string {
  return String(Math.trunc(n));
}

export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(cell).join(','));
  return BOM + lines.join('\r\n') + '\r\n';
}
