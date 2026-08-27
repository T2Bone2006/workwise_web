/**
 * Shared import prepare path (Phase 2 / 2b / 3).
 * Preview and importJobs both use these rules so green/red matches what gets written.
 */

import { resolvePostcodeDeterministic } from '@/lib/utils/postcode';
import { normalizeJobLength, normalizeJobLengthFromText } from '@/lib/jobs/normalize-job-length';
import {
  applyResolvedDate,
  isScheduledDateMapped,
} from '@/lib/import/parse-scheduled-date';
import type { ImportSchemaKey } from '@/lib/import/bind-columns';
import type { JobLengthEnum } from '@/lib/import/resolve-import-job-lengths';

const VALID_PRIORITIES = ['low', 'normal', 'high', 'emergency'] as const;
export type ImportPriority = (typeof VALID_PRIORITIES)[number];

export type ImportResolveMaps = {
  dates: Record<string, string>;
  postcodes: Record<string, string>;
  jobLengths: Record<string, JobLengthEnum>;
};

export const EMPTY_RESOLVE_MAPS: ImportResolveMaps = {
  dates: {},
  postcodes: {},
  jobLengths: {},
};

export type PreparedImportRow = {
  rowIndex: number;
  ok: boolean;
  errors: string[];
  warnings: string[];
  address: string;
  /** Normalised UK postcode, or '' if unresolved. */
  postcode: string;
  rawPostcode: string;
  mappedDescription: string;
  /** All non-empty spreadsheet columns (header → value) for jobs.source_fields / search. */
  sourceFields: Record<string, string>;
  /** Unmapped columns only — fed to AI description summary (not a spreadsheet dump of mapped fields). */
  unmappedAppendix: string;
  /** Fallback description if AI summary fails: mapped notes only (never the extras dump). */
  descriptionFallback: string;
  priority: ImportPriority;
  jobLength: JobLengthEnum | null;
  rawJobLength: string;
  scheduledDate: string | null;
  rawScheduledDate: string;
  referenceNumber: string;
};

function isMapped(
  columnMapping: Record<string, string | null | undefined>,
  field: string
): boolean {
  const col = columnMapping[field];
  return typeof col === 'string' && col.trim() !== '' && col !== '__NONE__';
}

export function isJobLengthMapped(
  columnMapping: Record<string, string | null | undefined>
): boolean {
  return isMapped(columnMapping, 'job_length');
}

export function isAddressMapped(
  columnMapping: Record<string, string | null | undefined>
): boolean {
  return isMapped(columnMapping, 'address');
}

export function isPostcodeMapped(
  columnMapping: Record<string, string | null | undefined>
): boolean {
  return isMapped(columnMapping, 'postcode');
}

/** Address + postcode columns must be mapped before import (values still cleaned per row). */
export function areCoreColumnsMapped(
  columnMapping: Record<string, string | null | undefined>
): boolean {
  return isAddressMapped(columnMapping) && isPostcodeMapped(columnMapping);
}

/**
 * Every non-empty spreadsheet column → source_fields (for search / job detail).
 * Includes columns mapped to WorkWise fields so values like "FULL DAY" stay searchable.
 */
export function collectSourceFields(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const col of Object.keys(row)) {
    if (!col.trim()) continue;
    const val = String(row[col] ?? '').trim();
    if (val === '') continue;
    out[col] = val;
  }
  return out;
}

/** Columns not bound to a WorkWise schema field — AI summary context only. */
export function collectUnmappedSourceFields(
  row: Record<string, string>,
  columnMapping: Record<string, string>
): Record<string, string> {
  const mappedCsvHeaders = new Set(
    Object.values(columnMapping).filter((c) => typeof c === 'string' && c.trim() !== '')
  );
  const out: Record<string, string> = {};
  for (const [col, val] of Object.entries(collectSourceFields(row))) {
    if (mappedCsvHeaders.has(col)) continue;
    out[col] = val;
  }
  return out;
}

/** AI-only appendix string (not written to job_description). */
export function formatSourceFieldsAppendix(sourceFields: Record<string, string>): string {
  return Object.entries(sourceFields)
    .map(([col, val]) => `${col}: ${val}`)
    .join(' | ');
}

/** @deprecated Prefer collectSourceFields / collectUnmappedSourceFields. */
export function formatUnmappedCsvColumns(
  row: Record<string, string>,
  columnMapping: Record<string, string>
): string {
  return formatSourceFieldsAppendix(collectUnmappedSourceFields(row, columnMapping));
}

function applyTransforms(
  field: string,
  raw: string,
  valueTransforms: Record<string, Record<string, string>>
): string {
  const t = valueTransforms[field];
  if (!t) return raw;
  const key = raw.trim() === '' ? 'default' : raw.trim();
  const mapped = t[key] ?? t['default'];
  if (mapped != null && mapped !== 'keep') return mapped;
  return raw;
}

export function getMappedRawValue(
  row: Record<string, string>,
  columnMapping: Record<string, string>,
  valueTransforms: Record<string, Record<string, string>>,
  field: ImportSchemaKey | string
): string {
  const csvCol = columnMapping[field];
  let value = '';
  if (csvCol && row[csvCol] != null) {
    value = String(row[csvCol]).trim();
  }
  if (valueTransforms[field]) {
    value = applyTransforms(field, value, valueTransforms);
  }
  return value;
}

function toPriority(val: string): ImportPriority {
  const v = val.toLowerCase().trim();
  if (!v) return 'normal';
  if (v === 'urgent') return 'emergency';
  return VALID_PRIORITIES.includes(v as ImportPriority) ? (v as ImportPriority) : 'normal';
}

export type PrepareImportOptions = {
  /** When false, unresolved absolute fields warn instead of hard-fail (AI still running). */
  absoluteFieldsReady?: boolean;
};

function applyPostcode(
  rawPostcode: string,
  address: string,
  postcodeMap: Record<string, string>
): string {
  const deterministic = resolvePostcodeDeterministic(rawPostcode, address);
  if (deterministic) return deterministic;
  if (rawPostcode.trim() && postcodeMap[rawPostcode.trim()]) {
    return postcodeMap[rawPostcode.trim()]!;
  }
  // AI sometimes keyed on the full messy string after coerce — try address as key too
  if (address.trim() && postcodeMap[address.trim()]) {
    return postcodeMap[address.trim()]!;
  }
  return '';
}

function applyJobLength(
  rawJobLength: string,
  textForLengthScan: string,
  jobLengthMapped: boolean,
  jobLengthMap: Record<string, JobLengthEnum>
): JobLengthEnum | null {
  let jobLength: JobLengthEnum | null = normalizeJobLength(rawJobLength || null);
  if (!jobLength && rawJobLength.trim() && jobLengthMap[rawJobLength.trim()]) {
    jobLength = jobLengthMap[rawJobLength.trim()]!;
  }
  if (!jobLengthMapped) {
    jobLength = jobLength ?? normalizeJobLengthFromText(textForLengthScan);
  }
  return jobLength;
}

export function prepareImportRow(
  rawRow: Record<string, string>,
  rowIndex: number,
  columnMapping: Record<string, string>,
  valueTransforms: Record<string, Record<string, string>>,
  resolveMaps: ImportResolveMaps,
  options: PrepareImportOptions = {}
): PreparedImportRow {
  const ready = options.absoluteFieldsReady !== false;
  const errors: string[] = [];
  const warnings: string[] = [];

  const address = getMappedRawValue(rawRow, columnMapping, valueTransforms, 'address');
  const rawPostcode = getMappedRawValue(rawRow, columnMapping, valueTransforms, 'postcode');
  const postcode = applyPostcode(rawPostcode, address, resolveMaps.postcodes);

  const mappedDescription = getMappedRawValue(
    rawRow,
    columnMapping,
    valueTransforms,
    'description'
  );
  const sourceFields = collectSourceFields(rawRow);
  const unmappedAppendix = formatSourceFieldsAppendix(
    collectUnmappedSourceFields(rawRow, columnMapping)
  );
  const descriptionFallback = mappedDescription.trim() || 'Imported job';
  const textForLengthScan = [mappedDescription, ...Object.values(sourceFields)]
    .filter(Boolean)
    .join(' ');

  const rawPriority = getMappedRawValue(rawRow, columnMapping, valueTransforms, 'priority');
  const priority = toPriority(rawPriority || valueTransforms.priority?.default || 'normal');

  const rawJobLength = getMappedRawValue(rawRow, columnMapping, valueTransforms, 'job_length');
  const jobLengthMapped = isJobLengthMapped(columnMapping);
  const jobLength = applyJobLength(
    rawJobLength,
    textForLengthScan,
    jobLengthMapped,
    resolveMaps.jobLengths
  );

  const dateMapped = isScheduledDateMapped(columnMapping);
  const rawScheduledDate = dateMapped
    ? getMappedRawValue(rawRow, columnMapping, valueTransforms, 'scheduled_date')
    : '';
  const scheduledDate = dateMapped
    ? applyResolvedDate(rawScheduledDate, resolveMaps.dates)
    : null;

  const referenceNumber = getMappedRawValue(
    rawRow,
    columnMapping,
    valueTransforms,
    'reference_number'
  );

  if (!address.trim()) errors.push('Missing address');
  if (!mappedDescription.trim() && Object.keys(sourceFields).length === 0) {
    errors.push('Missing description (map Description/Notes and/or keep other columns)');
  }

  if (!postcode) {
    const hint = rawPostcode.trim() || '(none in postcode column)';
    if (!ready) warnings.push('Resolving postcode…');
    else if (!rawPostcode.trim() && !address.trim()) errors.push('Missing postcode');
    else errors.push(`Invalid postcode ${rawPostcode.trim() ? `"${hint}"` : '(not found in address)'}`);
  }

  if (dateMapped) {
    if (!rawScheduledDate.trim()) {
      errors.push('Missing scheduled date');
    } else if (!scheduledDate) {
      if (!ready) warnings.push('Resolving date…');
      else errors.push(`Could not parse date "${rawScheduledDate}"`);
    }
  }

  if (jobLengthMapped) {
    if (!rawJobLength.trim()) {
      errors.push('Missing job length');
    } else if (!jobLength) {
      if (!ready) warnings.push('Resolving job length…');
      else errors.push(`Could not interpret job length "${rawJobLength}"`);
    }
  }

  return {
    rowIndex,
    ok: errors.length === 0,
    errors,
    warnings,
    address,
    postcode,
    rawPostcode,
    mappedDescription,
    sourceFields,
    unmappedAppendix,
    descriptionFallback,
    priority,
    jobLength,
    rawJobLength,
    scheduledDate,
    rawScheduledDate,
    referenceNumber,
  };
}

export function prepareImportRows(
  csvData: Record<string, string>[],
  columnMapping: Record<string, string>,
  valueTransforms: Record<string, Record<string, string>>,
  resolveMaps: ImportResolveMaps,
  options: PrepareImportOptions = {}
): PreparedImportRow[] {
  return csvData.map((row, i) =>
    prepareImportRow(row, i, columnMapping, valueTransforms, resolveMaps, options)
  );
}

/** Raw postcode cells (or address fallbacks) that still need AI after deterministic resolve. */
export function collectPostcodesNeedingAi(
  csvData: Record<string, string>[],
  columnMapping: Record<string, string>,
  valueTransforms: Record<string, Record<string, string>>
): string[] {
  const out: string[] = [];
  for (const row of csvData) {
    const address = getMappedRawValue(row, columnMapping, valueTransforms, 'address');
    const rawPostcode = getMappedRawValue(row, columnMapping, valueTransforms, 'postcode');
    if (resolvePostcodeDeterministic(rawPostcode, address)) continue;
    if (rawPostcode.trim()) out.push(rawPostcode.trim());
    else if (address.trim()) out.push(address.trim());
  }
  return out;
}

/** Raw job-length cells that need AI when job_length is mapped. */
export function collectJobLengthsNeedingAi(
  csvData: Record<string, string>[],
  columnMapping: Record<string, string>,
  valueTransforms: Record<string, Record<string, string>>
): string[] {
  if (!isJobLengthMapped(columnMapping)) return [];
  const out: string[] = [];
  for (const row of csvData) {
    const raw = getMappedRawValue(row, columnMapping, valueTransforms, 'job_length');
    if (!raw.trim()) continue;
    if (normalizeJobLength(raw)) continue;
    out.push(raw.trim());
  }
  return out;
}
