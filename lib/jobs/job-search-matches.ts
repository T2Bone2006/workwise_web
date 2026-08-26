/**
 * Jobs list search helpers (Phase 5): PostgREST or-filter + row match pills.
 */

export type JobMatchPill = {
  /** Shown on the row, e.g. "Warrant Officer: Smith" or "Postcode: WS1 3PH". */
  label: string;
};

const MAX_PILLS = 3;

/** Strip characters that break PostgREST `.or()` / ilike patterns. */
export function sanitizeSearchTerm(raw: string): string {
  return raw
    .trim()
    .replace(/[%*_,"()\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build `.or(...)` filter for jobs search.
 * Uses `*` as PostgREST's `%` alias. Includes generated `source_fields_text`.
 */
export function buildJobsSearchOrFilter(rawTerm: string): string | null {
  const term = sanitizeSearchTerm(rawTerm);
  if (!term) return null;
  const pattern = `*${term}*`;
  return [
    `address.ilike.${pattern}`,
    `postcode.ilike.${pattern}`,
    `reference_number.ilike.${pattern}`,
    `job_description.ilike.${pattern}`,
    `source_fields_text.ilike.${pattern}`,
  ].join(',');
}

function includesTerm(value: string | null | undefined, termLower: string): boolean {
  if (!value) return false;
  return value.toLowerCase().includes(termLower);
}

function corePill(fieldLabel: string, value: string): JobMatchPill {
  const trimmed = value.trim();
  if (trimmed.length <= 48) return { label: `${fieldLabel}: ${trimmed}` };
  return { label: `${fieldLabel}: ${trimmed.slice(0, 45)}…` };
}

export function parseSourceFields(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim()) out[k] = v;
    else if (v != null && typeof v !== 'object') out[k] = String(v);
  }
  return out;
}

type RankedPill = JobMatchPill & { rank: number };

/**
 * Why this row matched the active search.
 * Only the best-matching field(s) are shown — e.g. search "Walsall" → City: Walsall,
 * not also Description if it happens to repeat the same word.
 */
export function computeJobMatchPills(input: {
  search: string;
  reference_number?: string | null;
  address?: string | null;
  postcode?: string | null;
  job_description?: string | null;
  customer_name?: string | null;
  worker_name?: string | null;
  source_fields?: Record<string, string> | null;
}): JobMatchPill[] {
  const term = sanitizeSearchTerm(input.search);
  if (!term) return [];
  const termLower = term.toLowerCase();
  const ranked: RankedPill[] = [];

  const sourceFields = input.source_fields ?? {};
  for (const [key, value] of Object.entries(sourceFields)) {
    const valueHit = includesTerm(value, termLower);
    const keyHit = includesTerm(key, termLower);
    if (!valueHit && !keyHit) continue;
    // Value match beats key-only; shorter values rank slightly higher (more specific).
    const specificity = valueHit ? Math.min(value.trim().length, 80) : 200;
    ranked.push({
      label: `${key}: ${value}`,
      rank: (valueHit ? 0 : 10) + specificity / 1000,
    });
  }

  const core: Array<[string, string | null | undefined, number]> = [
    ['Postcode', input.postcode, 20],
    ['Reference', input.reference_number, 25],
    ['Address', input.address, 40],
    ['Customer', input.customer_name, 45],
    ['Worker', input.worker_name, 45],
    // Description often repeats city/names — lowest priority so it loses to City etc.
    ['Description', input.job_description, 90],
  ];

  for (const [label, value, base] of core) {
    if (!includesTerm(value, termLower)) continue;
    const specificity = Math.min(value!.trim().length, 80);
    ranked.push({
      ...corePill(label, value!),
      rank: base + specificity / 1000,
    });
  }

  if (ranked.length === 0) return [];

  ranked.sort((a, b) => a.rank - b.rank);
  const bestRank = ranked[0]!.rank;
  // Same "tier" ≈ same integer band (0–9 source value, 10–19 source key, 20+ core).
  const tier = Math.floor(bestRank / 10);
  return ranked
    .filter((p) => Math.floor(p.rank / 10) === tier)
    .slice(0, MAX_PILLS)
    .map(({ label }) => ({ label }));
}
