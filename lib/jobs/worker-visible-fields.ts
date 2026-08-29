/**
 * Per-customer control over which imported spreadsheet columns reach the
 * worker's job screen, and what they are called there.
 *
 * Pure helpers — safe to import from client components, and deliberately
 * mirrored in the mobile app (`src/lib/sourceFields.ts`). Keep the two in step:
 * `canonicalFieldKey` in particular decides whether a stored config entry still
 * matches an imported column, so a change here that is not made there silently
 * empties the job sheet.
 */

export interface WorkerVisibleField {
  /** Match key: lowercased, punctuation and spacing removed. */
  key: string;
  /** Last-seen spreadsheet header, for the dashboard to show alongside the label. */
  source_header: string;
  /** What the worker reads. Starts as the tidied header; editable per customer. */
  label: string;
  enabled: boolean;
}

/**
 * Collapses spelling drift so one column stays one field. `LOCK_TYPE`,
 * `Lock Type` and `locktype` all match.
 *
 * The same customer sending the same sheet each month already produces
 * identical headers, so this earns its keep only when someone re-exports from
 * a different system — but that is exactly the case that would otherwise blank
 * a column on every worker's screen with no warning.
 */
export function canonicalFieldKey(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Spreadsheet headers arrive however the customer typed them. Turn those into
 * something readable, without touching headers that already read like prose.
 *
 * No acronym handling: detecting them means maintaining a list that is wrong
 * for someone. `UPRN` becomes `Uprn` here, and the editable label is what
 * fixes that, once.
 */
export function fieldLabelFromHeader(header: string): string {
  const raw = header.trim();
  if (!raw) return '';
  // Already prose — spaced and not shouting. Leave it exactly as written.
  if (/\s/.test(raw) && raw !== raw.toUpperCase()) return raw;
  const words = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .split(/[\s_\-./]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  if (words.length === 0) return raw;
  const joined = words.join(' ');
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/** Reads the stored jsonb, dropping anything malformed rather than throwing. */
export function parseWorkerVisibleFields(raw: unknown): WorkerVisibleField[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return null;
  const out: WorkerVisibleField[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const candidate = item as Record<string, unknown>;
    const key = typeof candidate.key === 'string' ? candidate.key.trim() : '';
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const sourceHeader =
      typeof candidate.source_header === 'string' ? candidate.source_header : key;
    const label =
      typeof candidate.label === 'string' && candidate.label.trim()
        ? candidate.label.trim()
        : fieldLabelFromHeader(sourceHeader);
    out.push({
      key,
      source_header: sourceHeader,
      label,
      enabled: candidate.enabled !== false,
    });
  }
  return out;
}

/**
 * Merges the stored config with the headers actually seen in this customer's
 * jobs, so the editor lists everything that exists rather than only what was
 * configured last time.
 *
 * Columns the config has never seen come back enabled and flagged `isNew`. A
 * renamed or added column therefore shows up on the worker's screen straight
 * away and is surfaced for review, rather than quietly going missing.
 */
export function mergeFieldsWithHeaders(
  stored: WorkerVisibleField[] | null,
  headers: string[]
): { fields: WorkerVisibleField[]; newKeys: Set<string> } {
  const byKey = new Map<string, WorkerVisibleField>();
  for (const field of stored ?? []) {
    byKey.set(field.key, field);
  }

  const newKeys = new Set<string>();
  const discovered: WorkerVisibleField[] = [];

  for (const header of headers) {
    const trimmed = header.trim();
    if (!trimmed) continue;
    const key = canonicalFieldKey(trimmed);
    if (!key) continue;
    const existing = byKey.get(key);
    if (existing) {
      // Keep the config, but track the spelling this customer is using now.
      existing.source_header = trimmed;
      continue;
    }
    if (newKeys.has(key)) continue;
    newKeys.add(key);
    discovered.push({
      key,
      source_header: trimmed,
      label: fieldLabelFromHeader(trimmed),
      enabled: true,
    });
  }

  const ordered = [...(stored ?? []), ...discovered];
  ordered.sort((a, b) => {
    if (a.enabled === b.enabled) return 0;
    return a.enabled ? -1 : 1;
  });

  return { fields: ordered, newKeys };
}

/**
 * What the worker actually sees, resolved against one job's raw source fields.
 * `null` config means never configured, which shows everything.
 */
export function resolveJobSheetFields(
  sourceFields: Record<string, string>,
  config: WorkerVisibleField[] | null
): Array<{ label: string; value: string }> {
  const byKey = new Map<string, { header: string; value: string }>();
  for (const [header, value] of Object.entries(sourceFields)) {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) continue;
    const key = canonicalFieldKey(header);
    if (!key) continue;
    byKey.set(key, { header, value: trimmed });
  }

  if (config == null) {
    return [...byKey.values()]
      .map(({ header, value }) => ({ label: fieldLabelFromHeader(header), value }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  }

  const out: Array<{ label: string; value: string }> = [];
  const configured = new Set<string>();

  for (const field of config) {
    configured.add(field.key);
    if (!field.enabled) continue;
    const match = byKey.get(field.key);
    if (!match) continue;
    out.push({ label: field.label, value: match.value });
  }

  // A column the config has never seen is shown rather than hidden — a
  // renamed header must not silently disappear from the worker's screen.
  for (const [key, { header, value }] of byKey) {
    if (configured.has(key)) continue;
    out.push({ label: fieldLabelFromHeader(header), value });
  }

  return out;
}
