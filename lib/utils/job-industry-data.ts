/**
 * Parsed shape of `jobs.industry_data` (JSON) for locksmith / completion reporting.
 * Keys may be omitted; values may come from mobile as booleans or strings.
 */
export type JobIndustryData = {
  lock_changed?: unknown;
  walked_away?: unknown;
  walk_away?: unknown;
  walk_away_reason?: unknown;
  walk_away_detail?: unknown;
  start_time?: unknown;
  end_time?: unknown;
};

export function parseJobIndustryData(raw: unknown): JobIndustryData {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  return raw as JobIndustryData;
}

export function isIndustryDataEmpty(raw: unknown): boolean {
  const o = parseJobIndustryData(raw);
  return Object.keys(o).length === 0;
}

function triStateYesNo(v: unknown): 'Yes' | 'No' | null {
  if (v === true || v === 'true' || v === 'yes' || v === 'Yes' || v === 1) return 'Yes';
  if (v === false || v === 'false' || v === 'no' || v === 'No' || v === 0) return 'No';
  return null;
}

export function formatIndustryYesNo(v: unknown): string {
  return triStateYesNo(v) ?? '—';
}

export function walkedAwayFromIndustry(data: JobIndustryData): boolean | null {
  const a = triStateYesNo(data.walked_away);
  if (a != null) return a === 'Yes';
  const b = triStateYesNo(data.walk_away);
  if (b != null) return b === 'Yes';
  return null;
}

export function formatIndustryDateTime(value: unknown): string | null {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function nonEmptyString(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}
