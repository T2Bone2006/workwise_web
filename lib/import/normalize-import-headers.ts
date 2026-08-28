/**
 * Spreadsheet header hygiene for imports.
 * Pure helpers (safe for client + server).
 *
 * This is all that remains of the old column-binding step: imports no longer
 * map headers to schema fields — AI reads each whole row instead (see
 * extract-job-rows.ts). We still clean headers so row keys are consistent.
 */

export function normalizeHeader(header: string): string {
  return header.replace(/^\uFEFF/, '').trim();
}

export function normalizeHeaders(headers: string[]): string[] {
  return headers.map(normalizeHeader).filter((h) => h.length > 0);
}

/** Normalize row keys to match cleaned headers (BOM / trim). */
export function normalizeRowKeys(
  row: Record<string, string>,
  headers: string[]
): Record<string, string> {
  const byNorm = new Map<string, string>();
  for (const h of headers) {
    byNorm.set(h.toLowerCase(), h);
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    const cleaned = normalizeHeader(k);
    const canonical = byNorm.get(cleaned.toLowerCase()) ?? cleaned;
    out[canonical] = v == null ? '' : String(v);
  }
  return out;
}
