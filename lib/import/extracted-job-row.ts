/**
 * Row-level AI import extraction — shared types + deterministic validation.
 * Pure helpers (safe for client + server); the AI call lives in extract-job-rows.ts.
 *
 * Contract: AI proposes one structured job per spreadsheet row, seeing every
 * column at once. These validators dispose — nothing the model returns reaches
 * the database without passing the same checks the old mapped path used.
 * Absent values are '' (never null) so the model always fills every field.
 */

import { z } from 'zod';
import { parseScheduledDate } from '@/lib/import/parse-scheduled-date';
import { resolvePostcodeDeterministic } from '@/lib/utils/postcode';
import { normalizeJobLength } from '@/lib/jobs/normalize-job-length';

/**
 * Rows per AI extraction call. The client sends several batches in parallel.
 * Lives here, not in extract-job-rows.ts — a 'use server' module may only
 * export async server actions.
 */
export const EXTRACTION_BATCH_SIZE = 10;

export const PRIORITY_VALUES = ['low', 'normal', 'high', 'emergency'] as const;
export type ExtractedPriority = (typeof PRIORITY_VALUES)[number];
export type JobLengthEnum = 'half_day' | 'full_day';

/** What the model must return per row. Empty string = not present in the sheet. */
export const ExtractedJobRowSchema = z.object({
  row_index: z
    .number()
    .int()
    .describe('The 0-based index of the source row, copied from the input'),
  address: z.string().describe('Street/site address without the postcode. "" if absent.'),
  postcode: z.string().describe('UK postcode only, e.g. "SW1A 1AA". "" if absent.'),
  description: z
    .string()
    .describe(
      'One or two sentences briefing the worker: what needs doing, plus access, equipment, contact or constraint notes from the row. "" if nothing in the row describes work.'
    ),
  priority: z.enum(PRIORITY_VALUES).describe('Use "normal" unless the row says otherwise.'),
  scheduled_date: z
    .string()
    .describe('Visit date as YYYY-MM-DD. "" if the row has no date.'),
  start_time: z
    .string()
    .describe('24-hour start time as HH:MM. "" if the row has no start time.'),
  end_time: z
    .string()
    .describe('24-hour finish time as HH:MM. "" if the row has no finish time.'),
  job_length: z
    .enum(['half_day', 'full_day', 'unknown'])
    .describe('Coarse duration. "unknown" unless the row clearly states half or full day.'),
  reference_number: z
    .string()
    .describe('Job/work-order/contract reference. "" if absent.'),
});

export const ExtractionBatchSchema = z.object({
  jobs: z.array(ExtractedJobRowSchema),
});

export type ExtractedJobRow = z.infer<typeof ExtractedJobRowSchema>;

/** One row after AI extraction + deterministic validation. Drives the preview table. */
export type PreparedExtractedRow = {
  rowIndex: number;
  ok: boolean;
  errors: string[];
  /** Normalised UK postcode, or '' when unresolved. */
  postcode: string;
  rawPostcode: string;
  address: string;
  description: string;
  priority: ExtractedPriority;
  /** YYYY-MM-DD or null. */
  scheduledDate: string | null;
  rawScheduledDate: string;
  /** HH:MM or null. */
  startTime: string | null;
  endTime: string | null;
  jobLength: JobLengthEnum | null;
  referenceNumber: string;
  /** Every non-empty spreadsheet column, kept for jobs.source_fields / search. */
  sourceFields: Record<string, string>;
};

/** Fields a user may correct inline on a failed preview row. */
export type EditableRowField =
  | 'address'
  | 'postcode'
  | 'description'
  | 'scheduledDate'
  | 'startTime'
  | 'endTime';

export type RowEdits = Partial<Record<EditableRowField, string>>;

/** Accepts "9:00", "09:00", "0900", "9am", "17:30:00" → "HH:MM", else null. */
export function normalizeTimeOfDay(value: string | null | undefined): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const meridiem = raw.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*([AaPp])\.?[Mm]\.?$/);
  if (meridiem) {
    let hour = Number(meridiem[1]);
    const minute = Number(meridiem[2] ?? '0');
    const isPm = meridiem[3]!.toLowerCase() === 'p';
    if (hour < 1 || hour > 12 || minute > 59) return null;
    if (hour === 12) hour = 0;
    if (isPm) hour += 12;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  const colon = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (colon) {
    const hour = Number(colon[1]);
    const minute = Number(colon[2]);
    if (hour > 23 || minute > 59) return null;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  const compact = raw.match(/^(\d{2})(\d{2})$/);
  if (compact) {
    const hour = Number(compact[1]);
    const minute = Number(compact[2]);
    if (hour > 23 || minute > 59) return null;
    return `${compact[1]}:${compact[2]}`;
  }

  return null;
}

/**
 * Placeholder for a row we could not read — a model that skipped it, or a
 * batch whose AI call failed. Always fails validation, so an unreadable row
 * shows up red in the preview instead of silently vanishing from the import.
 */
export function blankExtractedRow(rowIndex: number): ExtractedJobRow {
  return {
    row_index: rowIndex,
    address: '',
    postcode: '',
    description: '',
    priority: 'normal',
    scheduled_date: '',
    start_time: '',
    end_time: '',
    job_length: 'unknown',
    reference_number: '',
  };
}

/** Every non-empty spreadsheet column → source_fields (searchable after import). */
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

/**
 * Validate one AI-extracted row against the same rules the mapped path enforced.
 * `edits` are user corrections from the preview table and win over AI values.
 */
export function prepareExtractedRow(
  extracted: ExtractedJobRow,
  rawRow: Record<string, string>,
  edits: RowEdits = {}
): PreparedExtractedRow {
  const errors: string[] = [];

  const address = (edits.address ?? extracted.address ?? '').trim();
  const rawPostcode = (edits.postcode ?? extracted.postcode ?? '').trim();
  const description = (edits.description ?? extracted.description ?? '').trim();
  const sourceFields = collectSourceFields(rawRow);

  // Deterministic postcode wins; fall back to scanning the address text.
  const postcode = resolvePostcodeDeterministic(rawPostcode, address) ?? '';

  const rawScheduledDate = (edits.scheduledDate ?? extracted.scheduled_date ?? '').trim();
  const scheduledDate = rawScheduledDate ? parseScheduledDate(rawScheduledDate) : null;

  const rawStart = (edits.startTime ?? extracted.start_time ?? '').trim();
  const rawEnd = (edits.endTime ?? extracted.end_time ?? '').trim();
  const startTime = normalizeTimeOfDay(rawStart);
  const endTime = normalizeTimeOfDay(rawEnd);

  const jobLength: JobLengthEnum | null =
    extracted.job_length === 'half_day' || extracted.job_length === 'full_day'
      ? extracted.job_length
      : normalizeJobLength(null);

  const referenceNumber = (extracted.reference_number ?? '').trim();

  if (!address) errors.push('Missing address');
  if (!description && Object.keys(sourceFields).length === 0) {
    errors.push('Missing description');
  }
  if (!postcode) {
    errors.push(
      rawPostcode
        ? `Invalid postcode "${rawPostcode}"`
        : 'Missing postcode (none found in the row)'
    );
  }
  // A date the sheet supplied but we cannot parse is an error; no date at all is fine.
  if (rawScheduledDate && !scheduledDate) {
    errors.push(`Could not read date "${rawScheduledDate}"`);
  }
  if (rawStart && !startTime) errors.push(`Could not read start time "${rawStart}"`);
  if (rawEnd && !endTime) errors.push(`Could not read finish time "${rawEnd}"`);
  if (startTime && endTime && endTime <= startTime) {
    errors.push('Finish time is not after start time');
  }

  return {
    rowIndex: extracted.row_index,
    ok: errors.length === 0,
    errors,
    postcode,
    rawPostcode,
    address,
    description,
    priority: extracted.priority ?? 'normal',
    scheduledDate,
    rawScheduledDate,
    startTime,
    endTime,
    jobLength,
    referenceNumber,
    sourceFields,
  };
}

/** Description written to the job when the sheet gave us nothing usable. */
export function descriptionForInsert(row: PreparedExtractedRow): string {
  return row.description.trim() || 'Imported job';
}
