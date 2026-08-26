/**
 * Phase 6: field → value filter helpers (system fields + source_fields keys).
 */

export const SOURCE_FIELD_PREFIX = 'sf:';

export type SystemFilterFieldKey =
  | 'status'
  | 'priority'
  | 'customer_id'
  | 'assigned_worker_id'
  | 'postcode';

export type SystemFilterFieldOption = {
  key: SystemFilterFieldKey;
  label: string;
};

export const SYSTEM_FILTER_FIELDS: SystemFilterFieldOption[] = [
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Priority' },
  { key: 'customer_id', label: 'Customer' },
  { key: 'assigned_worker_id', label: 'Worker' },
  { key: 'postcode', label: 'Postcode' },
];

export function isSourceFieldFilter(field: string): boolean {
  return field.startsWith(SOURCE_FIELD_PREFIX);
}

export function encodeSourceFieldFilter(key: string): string {
  return `${SOURCE_FIELD_PREFIX}${key}`;
}

export function decodeSourceFieldFilter(field: string): string | null {
  if (!isSourceFieldFilter(field)) return null;
  const key = field.slice(SOURCE_FIELD_PREFIX.length);
  return key.trim() ? key : null;
}

export function systemFilterFieldLabel(field: string): string {
  return SYSTEM_FILTER_FIELDS.find((f) => f.key === field)?.label ?? field;
}

/** Pill label for an active field filter (shown on matching rows). */
export function fieldFilterPillLabel(field: string, valueLabel: string): string {
  if (isSourceFieldFilter(field)) {
    const key = decodeSourceFieldFilter(field) ?? field;
    return `${key}: ${valueLabel}`;
  }
  return `${systemFilterFieldLabel(field)}: ${valueLabel}`;
}

export type FieldFilterValueOption = {
  value: string;
  label: string;
};

export type FieldFilterPair = {
  field: string;
  value: string;
};

const MAX_FIELD_FILTERS = 5;

/** Read stacked filters from URL (f0/v0… or legacy field/value). */
export function parseFieldFiltersFromSearchParams(raw: {
  field?: string | string[];
  value?: string | string[];
  [key: string]: string | string[] | undefined;
}): FieldFilterPair[] {
  const param = (key: string): string | undefined => {
    const v = raw[key];
    if (Array.isArray(v)) return v[0]?.trim() || undefined;
    return v?.trim() || undefined;
  };

  const out: FieldFilterPair[] = [];
  for (let i = 0; i < MAX_FIELD_FILTERS; i++) {
    const field = param(`f${i}`);
    const value = param(`v${i}`);
    if (field && value) out.push({ field, value });
  }
  if (out.length === 0) {
    const field = param('field');
    const value = param('value');
    if (field && value) out.push({ field, value });
  }
  return out;
}

/** Write stacked filters into a URLSearchParams (clears legacy field/value and old fN/vN). */
export function writeFieldFiltersToSearchParams(
  params: URLSearchParams,
  filters: Array<{ field: string | null; value: string | null }>
): void {
  params.delete('field');
  params.delete('value');
  for (let i = 0; i < MAX_FIELD_FILTERS; i++) {
    params.delete(`f${i}`);
    params.delete(`v${i}`);
  }
  let idx = 0;
  for (const row of filters) {
    if (!row.field?.trim() || row.value == null || row.value === '') continue;
    if (idx >= MAX_FIELD_FILTERS) break;
    params.set(`f${idx}`, row.field.trim());
    params.set(`v${idx}`, row.value);
    idx += 1;
  }
}

export { MAX_FIELD_FILTERS };
