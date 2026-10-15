/**
 * Field groups: one business-wide named field (e.g. "Warrant Officer") that
 * bundles the differently-named spreadsheet headers that all mean the same
 * thing (`W/O`, `B/R Name`, …).
 *
 * Pure helpers — safe for client and server. Groups live in
 * `tenants.settings.field_groups`; nothing on a stored job is rewritten. A job
 * keeps its original `source_fields`, and the group is applied when the jobs
 * are read, so adding or removing a header from a group changes old jobs too.
 */

export const FIELD_GROUP_PREFIX = 'fg:';

export const MAX_FIELD_GROUPS = 40;
export const MAX_GROUP_ALIASES = 30;
const MAX_NAME_LENGTH = 60;
const MAX_HEADER_LENGTH = 120;

export interface FieldGroup {
  id: string;
  name: string;
  /** Exact spreadsheet headers, as they appear in `source_fields`. */
  aliases: string[];
}

export function isFieldGroupRef(value: string): boolean {
  return value.startsWith(FIELD_GROUP_PREFIX);
}

export function encodeFieldGroupRef(id: string): string {
  return `${FIELD_GROUP_PREFIX}${id}`;
}

export function decodeFieldGroupRef(value: string): string | null {
  if (!isFieldGroupRef(value)) return null;
  const id = value.slice(FIELD_GROUP_PREFIX.length).trim();
  return id || null;
}

/** Reads the stored jsonb, dropping anything malformed rather than throwing. */
export function parseFieldGroups(raw: unknown): FieldGroup[] {
  if (!Array.isArray(raw)) return [];
  const out: FieldGroup[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === 'string' ? rec.id.trim() : '';
    const name = typeof rec.name === 'string' ? rec.name.trim() : '';
    if (!id || !name || seen.has(id)) continue;
    const aliases = Array.isArray(rec.aliases)
      ? rec.aliases.filter((a): a is string => typeof a === 'string' && a.trim() !== '')
      : [];
    seen.add(id);
    out.push({ id, name, aliases });
  }
  return out;
}

export type NormaliseResult =
  | { ok: true; groups: FieldGroup[] }
  | { ok: false; error: string };

/**
 * Checks what the owner submitted. A header may belong to only one group,
 * otherwise the same column would feed two fields and filters would disagree.
 * `newId` makes ids for groups that don't have one yet.
 */
export function normaliseFieldGroups(
  input: Array<{ id?: string | null; name: string; aliases: string[] }>,
  newId: () => string
): NormaliseResult {
  if (input.length > MAX_FIELD_GROUPS) {
    return { ok: false, error: `You can have up to ${MAX_FIELD_GROUPS} fields.` };
  }
  const groups: FieldGroup[] = [];
  const ids = new Set<string>();
  const names = new Map<string, string>();
  const owner = new Map<string, string>();

  for (const item of input) {
    const name = item.name.trim().replace(/\s+/g, ' ');
    if (!name) return { ok: false, error: 'Give every field a name.' };
    if (name.length > MAX_NAME_LENGTH) {
      return { ok: false, error: `"${name.slice(0, 20)}…" is too long for a field name.` };
    }
    const nameKey = name.toLowerCase();
    if (names.has(nameKey)) {
      return { ok: false, error: `You already have a field called "${name}".` };
    }
    names.set(nameKey, name);

    const aliases: string[] = [];
    for (const raw of item.aliases) {
      const header = raw.trim();
      if (!header) continue;
      if (header.length > MAX_HEADER_LENGTH) {
        return { ok: false, error: `"${header.slice(0, 20)}…" is too long for a column name.` };
      }
      if (aliases.includes(header)) continue;
      const taken = owner.get(header);
      if (taken && taken !== name) {
        return { ok: false, error: `"${header}" is already in "${taken}". A column can only be in one field.` };
      }
      owner.set(header, name);
      aliases.push(header);
    }
    if (aliases.length > MAX_GROUP_ALIASES) {
      return { ok: false, error: `"${name}" has too many columns (up to ${MAX_GROUP_ALIASES}).` };
    }

    let id = item.id?.trim() || '';
    if (!id || ids.has(id)) id = newId();
    ids.add(id);
    groups.push({ id, name, aliases });
  }
  return { ok: true, groups };
}

/** Which group (if any) a spreadsheet header belongs to. */
export function groupForHeader(groups: FieldGroup[], header: string): FieldGroup | null {
  return groups.find((g) => g.aliases.includes(header)) ?? null;
}

/**
 * What a job holds for this group: the value under the first alias (in the
 * order the owner listed them) that the job actually has. A job normally comes
 * from one spreadsheet, so it carries one of the aliases, not several.
 */
export function valueForFieldGroup(
  group: Pick<FieldGroup, 'aliases'>,
  sourceFields: Record<string, string> | null | undefined
): string {
  if (!sourceFields) return '';
  for (const alias of group.aliases) {
    const value = sourceFields[alias]?.trim();
    if (value) return value;
  }
  return '';
}

/** Headers not yet in any group, in a stable, readable order. */
export function ungroupedHeaders(headers: string[], groups: FieldGroup[]): string[] {
  const grouped = new Set(groups.flatMap((g) => g.aliases));
  return headers
    .filter((h) => !grouped.has(h))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/**
 * PostgREST `or` filter for jobs whose `source_fields` hold `value` under ANY
 * of a field group's headers. Each JSON object is double-quoted so a comma,
 * bracket or quote in a header or value can't break the filter apart.
 */
export function buildFieldGroupValueFilter(aliases: string[], value: string): string {
  return aliases
    .map((alias) => {
      const json = JSON.stringify({ [alias]: value });
      const quoted = `"${json.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
      return `source_fields.cs.${quoted}`;
    })
    .join(',');
}
