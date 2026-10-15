/**
 * The questions a business asks on the finish-job form, turned into rows for
 * the job page. Labels and order come from that business's
 * `settings.job_report_fields`. A follow-up stays off the page unless its
 * `show_when` matches, the same rule the phone uses to reveal it.
 */

import { formatIndustryDateTime, triStateYesNo } from '@/lib/utils/job-industry-data';

export interface JobReportRow {
  id: string;
  label: string;
  /** "Yes", "No", the written answer, or "—" when the question was shown and left blank. */
  value: string;
  multiline: boolean;
}

const BLANK = '—';

/** On every finish form, ahead of the business's own questions. */
const BUILT_IN_FIELDS: Array<{ id: string; label: string }> = [
  { id: 'job_completed', label: 'Job completed?' },
  { id: 'incomplete_reason', label: 'Reason for not completing' },
];

/** Shown elsewhere on the page, or not an answer the owner needs repeated. */
const SKIPPED_KEYS = new Set(['job_notes', 'pause_reason']);

/**
 * The office editor writes `walked_away`. The phone, and every current
 * settings file, writes `walk_away`. One question, whichever key holds it.
 */
const WALK_AWAY_KEYS = new Set(['walk_away', 'walked_away']);

interface ShowWhen {
  field: string;
  value: boolean | string;
}

interface ReportField {
  id: string;
  label: string;
  multiline: boolean;
  showWhen: ShowWhen | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseShowWhen(value: unknown): ShowWhen | null {
  const record = asRecord(value);
  if (typeof record.field !== 'string' || record.field.length === 0) return null;
  if (typeof record.value === 'boolean' || typeof record.value === 'string') {
    return { field: record.field, value: record.value };
  }
  return null;
}

function parseReportFields(value: unknown): ReportField[] {
  if (!Array.isArray(value)) return [];
  const fields: ReportField[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const record = asRecord(item);
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const label = typeof record.label === 'string' ? record.label.trim() : '';
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    fields.push({
      id,
      label,
      multiline: record.multiline === true,
      showWhen: parseShowWhen(record.show_when),
    });
  }
  return fields;
}

function storedValue(data: Record<string, unknown>, id: string): unknown {
  if (WALK_AWAY_KEYS.has(id)) {
    if (data.walked_away != null && data.walked_away !== '') return data.walked_away;
    return data.walk_away;
  }
  return data[id];
}

function formatAnswer(value: unknown): string {
  const yesNo = triStateYesNo(value);
  if (yesNo) return yesNo;
  if (value == null) return '';
  return String(value).trim();
}

function matches(actual: unknown, expected: boolean | string): boolean {
  if (typeof expected === 'boolean') {
    const yesNo = triStateYesNo(actual);
    return expected ? yesNo === 'Yes' : yesNo === 'No';
  }
  if (actual == null) return false;
  return String(actual).trim() === expected;
}

function isVisible(field: ReportField, data: Record<string, unknown>): boolean {
  if (!field.showWhen) return true;
  return matches(storedValue(data, field.showWhen.field), field.showWhen.value);
}

function labelFromKey(key: string): string {
  const words = key.replace(/_/g, ' ').trim();
  if (!words) return key;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Rows for the job page.
 *
 * Once any answer from the form is stored, every question that was actually
 * on screen is listed, blanks included, so a missed answer is visible. A job
 * with no report yet produces no rows. Follow-ups the engineer never saw are
 * left out. Answers for a question since removed from settings are kept, so
 * an old job does not lose its record.
 */
export function visibleJobReportRows(industryData: unknown, reportFields: unknown): JobReportRow[] {
  const data = asRecord(industryData);
  const fields = parseReportFields(reportFields);
  const configuredIds = new Set(fields.map((field) => field.id));

  const leftoverKeys = Object.keys(data).filter((key) => {
    if (SKIPPED_KEYS.has(key) || configuredIds.has(key)) return false;
    if (WALK_AWAY_KEYS.has(key) && (configuredIds.has('walk_away') || configuredIds.has('walked_away'))) {
      return false;
    }
    return formatAnswer(storedValue(data, key)) !== '';
  });

  const hasReport =
    fields.some((field) => formatAnswer(storedValue(data, field.id)) !== '') ||
    BUILT_IN_FIELDS.some((field) => formatAnswer(data[field.id]) !== '') ||
    leftoverKeys.length > 0;

  if (!hasReport) return [];

  const rows: JobReportRow[] = [];
  const emitted = new Set<string>();

  const push = (id: string, label: string, raw: unknown, multiline: boolean) => {
    if (emitted.has(id)) return;
    emitted.add(id);
    const value = formatAnswer(raw);
    rows.push({
      id,
      label,
      value: value || BLANK,
      multiline: multiline || value.includes('\n'),
    });
  };

  const jobCompleted = triStateYesNo(data.job_completed);
  if (jobCompleted) {
    push('job_completed', 'Job completed?', data.job_completed, false);
  }
  if (formatAnswer(data.incomplete_reason) !== '' || jobCompleted === 'No') {
    push('incomplete_reason', 'Reason for not completing', data.incomplete_reason, false);
  }

  for (const field of fields) {
    if (!isVisible(field, data)) continue;
    push(field.id, field.label, storedValue(data, field.id), field.multiline);
  }

  for (const key of leftoverKeys) {
    if (key === 'start_time' || key === 'end_time') {
      const formatted = formatIndustryDateTime(data[key]);
      if (formatted) push(key, labelFromKey(key), formatted, false);
      continue;
    }
    push(key, labelFromKey(key), storedValue(data, key), false);
  }

  return rows;
}
