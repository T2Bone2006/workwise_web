/**
 * Deterministic scheduled-date parsing for imports.
 * Safe for client and server. Returns YYYY-MM-DD or null.
 */

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

/** Excel serial epoch: 1899-12-30 UTC (accounts for Excel's leap-year bug window). */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

function isValidYmd(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  if (year < 1900 || year > 2100) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() + 1 === month &&
    d.getUTCDate() === day
  );
}

function toIso(year: number, month: number, day: number): string | null {
  if (!isValidYmd(year, month, day)) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Strip time / timezone tails: "26/08/2026 00:00", "2026-08-26T00:00:00.000Z" */
function stripTime(value: string): string {
  let s = value.trim();
  // ISO date-time
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})[T\s]/i);
  if (iso?.[1]) return iso[1];
  // Space or " at " then time
  s = s.replace(/\s+at\s+\d{1,2}:\d{2}.*$/i, '');
  s = s.replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\s*[AaPp][Mm])?.*$/, '');
  return s.trim();
}

function parseExcelSerialNumber(n: number): string | null {
  // Typical Excel date serials for 2000–2100 are roughly 36526–73050
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return null;
  const ms = EXCEL_EPOCH_MS + Math.floor(n) * 86400000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return toIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function parseExcelSerial(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  return parseExcelSerialNumber(Number(trimmed));
}

/**
 * Convert a JS Date from SheetJS (`cellDates: true`) to YYYY-MM-DD.
 * Prefer local YMD when the clock is local midnight (common SheetJS behaviour);
 * otherwise use UTC YMD so timezone shifts don't flip the calendar day.
 */
function dateObjectToIso(d: Date): string | null {
  if (Number.isNaN(d.getTime())) return null;
  const localMidnight =
    d.getHours() === 0 &&
    d.getMinutes() === 0 &&
    d.getSeconds() === 0 &&
    d.getMilliseconds() === 0;
  if (localMidnight) {
    return toIso(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  return toIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * Normalise one spreadsheet cell for import rows.
 * Excel date cells must become YYYY-MM-DD here — never locale strings like
 * "9/1/2026", which our UK day-first parser would read as 9 January.
 */
export function spreadsheetCellToImportString(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) {
    return dateObjectToIso(value) ?? '';
  }
  if (typeof value === 'number') {
    // Leave non-date numbers as digits. Date cells should arrive as Date when
    // cellDates is on; if Excel only stores a serial, parseScheduledDate still
    // converts it when that column is mapped to scheduled_date.
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value).trim();
}

/**
 * Parse a spreadsheet date cell into YYYY-MM-DD.
 * Assumes day-first (UK) for numeric ambiguous forms like 01/02/2026.
 */
export function parseScheduledDate(value: string | null | undefined): string | null {
  if (value == null) return null;
  const original = String(value).trim();
  if (!original) return null;

  const serial = parseExcelSerial(original);
  if (serial) return serial;

  const trimmed = stripTime(original);
  if (!trimmed) return null;

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split('-').map(Number);
    return toIso(y!, m!, d!);
  }

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  let match = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    return toIso(year, month, day);
  }

  // DD/MM/YY (assume 2000–2099)
  match = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})$/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = 2000 + Number(match[3]);
    return toIso(year, month, day);
  }

  // 26-Aug-2026 / 26 Aug 2026 / 26 August 2026
  match = trimmed.match(/^(\d{1,2})[/.\-\s]+([A-Za-z]+)[/.\-\s]+(\d{4})$/);
  if (match) {
    const day = Number(match[1]);
    const month = MONTHS[match[2]!.toLowerCase()];
    const year = Number(match[3]);
    if (month) return toIso(year, month, day);
  }

  // Aug 26, 2026 / August 26 2026
  match = trimmed.match(/^([A-Za-z]+)[/.\-\s]+(\d{1,2}),?[/.\-\s]+(\d{4})$/);
  if (match) {
    const month = MONTHS[match[1]!.toLowerCase()];
    const day = Number(match[2]);
    const year = Number(match[3]);
    if (month) return toIso(year, month, day);
  }

  return null;
}

/**
 * Resolve one raw cell: deterministic first, then AI map lookup.
 */
export function applyResolvedDate(
  raw: string | null | undefined,
  aiMap: Record<string, string>
): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  return parseScheduledDate(trimmed) ?? aiMap[trimmed] ?? null;
}

/** True when a scheduled_date column is mapped to a real CSV header. */
export function isScheduledDateMapped(
  columnMapping: Record<string, string | null | undefined> | null | undefined
): boolean {
  if (!columnMapping) return false;
  const col = columnMapping.scheduled_date;
  return typeof col === 'string' && col.trim() !== '' && col !== '__NONE__';
}

/**
 * Raw date cells that need AI (non-empty and failed deterministic parse).
 * Same collection used by preview and importJobs.
 */
export function collectUnparsedDateValues(
  rows: Record<string, string>[],
  scheduledDateCsvColumn: string | null | undefined
): string[] {
  if (!scheduledDateCsvColumn?.trim() || scheduledDateCsvColumn === '__NONE__') {
    return [];
  }
  const out: string[] = [];
  for (const row of rows) {
    const raw = String(row[scheduledDateCsvColumn] ?? '').trim();
    if (raw && !parseScheduledDate(raw)) out.push(raw);
  }
  return out;
}

/** Order-independent equality of spreadsheet header sets. */
export function headerSetsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((h) => setB.has(h));
}
