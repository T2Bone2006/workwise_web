/**
 * Column binding for imports — Phase 1.
 * Pure helpers (safe for client + server). AI call lives in /api/map-columns.
 *
 * Contract: mapping is always { our_field: exact_spreadsheet_header }.
 * Values must snap to real headers; invented names become null.
 */

export const IMPORT_SCHEMA_KEYS = [
  'address',
  'postcode',
  'description',
  'priority',
  'job_length',
  'reference_number',
  'scheduled_date',
] as const;

export type ImportSchemaKey = (typeof IMPORT_SCHEMA_KEYS)[number];

export type ColumnMapping = Partial<Record<ImportSchemaKey, string | null>>;

export type ValueTransforms = Partial<
  Record<ImportSchemaKey, Record<string, string>>
>;

export type BindColumnsResult = {
  mapping: Record<string, string | null>;
  transforms: ValueTransforms;
  /** Core fields filled by alias rules before AI. */
  aliasedFields: ImportSchemaKey[];
};

const PRIORITY_VALUES = new Set(['low', 'normal', 'high', 'emergency']);
const JOB_LENGTH_VALUES = new Set(['half_day', 'full_day']);

/** Header → core field alias patterns (UK field-service sheets). */
const FIELD_ALIASES: Record<ImportSchemaKey, RegExp[]> = {
  address: [/^address$/i, /address\s+of\s+visit/i, /job\s+address/i, /^street$/i, /site\s+address/i],
  postcode: [/^post\s*code$/i, /^postcode$/i, /^zip(\s*code)?$/i],
  description: [/^notes?$/i, /^description$/i, /job\s+details?/i, /work\s+required/i],
  priority: [/^priority$/i, /urgency/i],
  job_length: [
    /time\s+required/i,
    /^duration$/i,
    /job\s+length/i,
    /^shift$/i,
    /appointment\s+length/i,
  ],
  reference_number: [
    /^reference$/i,
    /reference\s*(number|no\.?|#)?$/i,
    /contract\s+number/i,
    /work\s*order/i,
    /^job\s*(ref|number|no\.?|#)/i,
  ],
  scheduled_date: [
    /date\s+required/i,
    /scheduled\s+date/i,
    /visit\s+date/i,
    /^date$/i,
    /appointment\s+date/i,
  ],
};

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

export function snapToHeader(value: string, headers: string[]): string | null {
  if (headers.includes(value)) return value;
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const target = norm(value);
  return headers.find((h) => norm(h) === target) ?? null;
}

export function snapColumnMapping(
  mapping: Record<string, string | null | undefined>,
  headers: string[]
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const key of IMPORT_SCHEMA_KEYS) {
    const raw = mapping[key];
    if (raw == null || String(raw).trim() === '') {
      out[key] = null;
      continue;
    }
    out[key] = snapToHeader(String(raw), headers);
  }
  return out;
}

/**
 * Deterministic header→field matches. Only claims a header when exactly one
 * strong alias hits and the header is not already taken.
 */
export function applyAliasRules(headers: string[]): {
  mapping: Record<string, string | null>;
  aliasedFields: ImportSchemaKey[];
} {
  const mapping: Record<string, string | null> = {};
  for (const key of IMPORT_SCHEMA_KEYS) mapping[key] = null;

  const claimed = new Set<string>();
  const aliasedFields: ImportSchemaKey[] = [];

  for (const key of IMPORT_SCHEMA_KEYS) {
    const patterns = FIELD_ALIASES[key];
    const hits = headers.filter(
      (h) => !claimed.has(h) && patterns.some((re) => re.test(h))
    );
    if (hits.length === 1) {
      const header = hits[0]!;
      mapping[key] = header;
      claimed.add(header);
      aliasedFields.push(key);
    }
  }

  return { mapping, aliasedFields };
}

/** Merge AI mapping over aliases; aliases win when AI left null. Then snap. */
export function mergeAliasAndAiMapping(
  headers: string[],
  aliasMapping: Record<string, string | null>,
  aiMapping: Record<string, string | null | undefined>
): Record<string, string | null> {
  const merged: Record<string, string | null> = {};
  for (const key of IMPORT_SCHEMA_KEYS) {
    const fromAi = aiMapping[key];
    const fromAlias = aliasMapping[key];
    if (fromAlias) {
      merged[key] = fromAlias;
    } else if (fromAi != null && String(fromAi).trim() !== '') {
      merged[key] = String(fromAi);
    } else {
      merged[key] = null;
    }
  }
  return snapColumnMapping(merged, headers);
}

export function sanitizeValueTransforms(
  raw: ValueTransforms | Record<string, Record<string, string>> | undefined
): ValueTransforms {
  const out: ValueTransforms = {};
  if (!raw) {
    out.priority = { default: 'normal' };
    return out;
  }

  if (raw.priority && typeof raw.priority === 'object') {
    const p: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.priority)) {
      if (typeof v !== 'string') continue;
      const normalized = v.trim().toLowerCase();
      if (k === 'default') {
        p.default = PRIORITY_VALUES.has(normalized) ? normalized : 'normal';
        continue;
      }
      if (PRIORITY_VALUES.has(normalized)) p[k] = normalized;
      else if (normalized === 'urgent') p[k] = 'emergency';
    }
    if (!p.default) p.default = 'normal';
    out.priority = p;
  } else {
    out.priority = { default: 'normal' };
  }

  if (raw.job_length && typeof raw.job_length === 'object') {
    const j: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.job_length)) {
      if (k === 'default') continue; // never allow default for job_length
      if (typeof v !== 'string') continue;
      const normalized = v.trim().toLowerCase().replace(/\s+/g, '_');
      if (JOB_LENGTH_VALUES.has(normalized)) j[k] = normalized;
      else if (/full/.test(normalized)) j[k] = 'full_day';
      else if (/half/.test(normalized)) j[k] = 'half_day';
    }
    if (Object.keys(j).length > 0) out.job_length = j;
  }

  return out;
}

export function formatSampleRowsForBind(
  columnNames: string[],
  sampleRows: Record<string, string>[]
): string {
  const rows = sampleRows.slice(0, 5);
  return columnNames
    .map((col) => {
      const values = rows
        .map((row) => {
          const v = String(row[col] ?? '').trim();
          return v ? `"${v.replace(/"/g, '\\"')}"` : null;
        })
        .filter((v): v is string => v != null);
      return values.length > 0 ? `- ${col}: ${values.join(', ')}` : `- ${col}: (empty)`;
    })
    .join('\n');
}

/** Fields still needing an AI pick (not already aliased). */
export function unboundSchemaKeys(
  aliasMapping: Record<string, string | null>
): ImportSchemaKey[] {
  return IMPORT_SCHEMA_KEYS.filter((k) => !aliasMapping[k]);
}

export function buildBindPrompt(params: {
  headers: string[];
  sampleSection: string;
  unboundKeys: ImportSchemaKey[];
  aliasMapping: Record<string, string | null>;
}): string {
  const { headers, sampleSection, unboundKeys, aliasMapping } = params;

  const alreadyBound = IMPORT_SCHEMA_KEYS.filter((k) => aliasMapping[k]).map(
    (k) => `- ${k}: already bound to ${JSON.stringify(aliasMapping[k])} (do not change)`
  );

  const needBind =
    unboundKeys.length === 0
      ? '(none — only return valueTransforms)'
      : unboundKeys.map((k) => `- ${k}`).join('\n');

  // Example uses ONLY real headers — never invented names.
  const exampleMapping: Record<string, string | null> = {};
  for (const key of IMPORT_SCHEMA_KEYS) {
    exampleMapping[key] = aliasMapping[key] ?? null;
  }
  // For unbound, show null in example so model doesn't copy fake names
  for (const key of unboundKeys) {
    exampleMapping[key] = null;
  }

  return `You map spreadsheet columns to a job schema and normalise enum values.

Spreadsheet columns and sample values:
${sampleSection}

ALLOWED headers (copy EXACTLY character-for-character, or null). Never invent names:
${JSON.stringify(headers)}

Already bound by rules (keep these; do not reassign their headers to other fields):
${alreadyBound.length ? alreadyBound.join('\n') : '(none)'}

Fields you must fill (use an ALLOWED header or null):
${needBind}

Schema meanings:
- address: job/site address
- postcode: UK postcode
- description: job notes / details
- priority: enum low|normal|high|emergency
- job_length: duration half_day|full_day (not a clock start time)
- reference_number: optional job/contract ref
- scheduled_date: optional visit/required date

Return ONLY valid JSON:
{
  "columnMapping": { ... our_field: allowed_header_or_null ... },
  "valueTransforms": {
    "priority": { "...sample...": "emergency"|"high"|"normal"|"low", "default": "normal" },
    "job_length": { "...sample...": "full_day"|"half_day" }
  }
}

Example shape (nulls where unbound — replace nulls with EXACT allowed headers when confident):
${JSON.stringify({ columnMapping: exampleMapping, valueTransforms: { priority: { default: 'normal' }, job_length: {} } }, null, 2)}

Rules:
- columnMapping values MUST be in the ALLOWED list or null
- Do not map customer/name columns (customer is chosen in the UI)
- If no priority column, priority: null and valueTransforms.priority.default = "normal"
- Never put "default" on job_length
- job_length: only clear half/full duration samples; omit unclear values
- Return JSON only, no markdown`;
}

/** How many critical fields are mapped (for UI warnings). */
export function countCriticalMappings(
  mapping: Record<string, string | null | undefined>
): { critical: number; total: number } {
  const criticalKeys: ImportSchemaKey[] = ['address', 'postcode', 'description'];
  const critical = criticalKeys.filter((k) => mapping[k]).length;
  const total = IMPORT_SCHEMA_KEYS.filter((k) => mapping[k]).length;
  return { critical, total };
}
