/**
 * Reads a .csv / .xlsx file into header-cleaned row records.
 * Client-side only (needs File). Shared by the Pro job import and the Rounds
 * customer import; the logic moved here from import-wizard.tsx unchanged.
 */

import Papa from 'papaparse';
import type * as XLSXTypes from 'xlsx';
import {
  normalizeHeaders,
  normalizeRowKeys,
} from '@/lib/import/normalize-import-headers';
import { spreadsheetCellToImportString } from '@/lib/import/parse-scheduled-date';

export type SpreadsheetParseFailure = 'empty' | 'no-headers' | 'invalid';

export function isSpreadsheetImportFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith('.csv') || lower.endsWith('.xlsx');
}

function xlsxWorkbookToRowRecords(
  XLSX: typeof XLSXTypes,
  wb: XLSXTypes.WorkBook
): Record<string, string>[] {
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) return [];
  const ws = wb.Sheets[firstSheet];
  // raw + cellDates: date cells become Date/serial, not locale strings like "9/1/2026".
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: '',
    raw: true,
  });
  return json
    .map((row) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(row)) {
        out[k] = spreadsheetCellToImportString(v);
      }
      return out;
    })
    .filter((row) => Object.values(row).some((v) => v.trim() !== ''));
}

function finishRows(rows: Record<string, string>[]): Record<string, string>[] {
  if (!rows.length) throw new Error('empty' satisfies SpreadsheetParseFailure);
  const headers = normalizeHeaders(Object.keys(rows[0]!));
  if (!headers.length) throw new Error('no-headers' satisfies SpreadsheetParseFailure);
  return rows.map((row) => normalizeRowKeys(row, headers));
}

/**
 * Parses .csv/.xlsx into header-normalised rows. Throws
 * Error('empty' | 'no-headers' | 'invalid') for the caller to turn into a toast.
 */
export async function parseSpreadsheetFile(file: File): Promise<Record<string, string>[]> {
  const lower = file.name.toLowerCase();

  if (lower.endsWith('.xlsx')) {
    let rows: Record<string, string>[];
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      rows = xlsxWorkbookToRowRecords(XLSX, wb);
    } catch {
      throw new Error('invalid' satisfies SpreadsheetParseFailure);
    }
    return finishRows(rows);
  }

  const rows = await new Promise<Record<string, string>[]>((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => resolve(results.data as Record<string, string>[]),
      error: () => reject(new Error('invalid' satisfies SpreadsheetParseFailure)),
    });
  });
  return finishRows(rows);
}

/** The toast text the Pro wizard has always shown for each failure. */
export function spreadsheetFailureMessage(error: unknown, fileName: string): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'empty') return 'File has no data rows.';
  if (code === 'no-headers') return 'File has no usable column headers.';
  return fileName.toLowerCase().endsWith('.xlsx') ? 'Invalid Excel file.' : 'Invalid CSV format.';
}
