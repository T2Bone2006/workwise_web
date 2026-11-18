/**
 * What the jobs export contains, kept apart from the dialog so it can be tested.
 *
 * The export follows the jobs table: it opens with the columns the table is showing ticked, and a field group
 * (see field-groups.ts) is written as ONE column holding whichever spreadsheet header each job has, instead of
 * the raw headers (`W/O`, `B/R Name`, ...) scattered across customers' tabs.
 */
import type { ExportJobRow } from '@/lib/data/jobs';
import type { JobsListColumnKey } from '@/lib/data/settings-types';
import { JOB_STATUS_DISPLAY } from '@/lib/job-status-display';
import { valueForFieldGroup, type FieldGroup } from '@/lib/jobs/field-groups';

export type ExportableRow = ExportJobRow;

export function formatDateForExport(value: string | null | undefined): string {
  if (!value) return '';
  const source = value.length <= 10 ? `${value}T12:00:00` : value;
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${String(date.getFullYear())}`;
}

export function formatDateTimeForExport(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${String(date.getFullYear())} ${hours}:${minutes}`;
}

export const EXPORT_COLUMNS: { key: string; label: string; get: (job: ExportableRow) => string }[] = [
  { key: 'reference_number', label: 'Job Ref', get: (j) => j.reference_number ?? '' },
  { key: 'customer_name', label: 'Customer', get: (j) => j.customer_name ?? '' },
  { key: 'address', label: 'Address', get: (j) => j.address ?? '' },
  { key: 'postcode', label: 'Postcode', get: (j) => j.postcode ?? '' },
  { key: 'job_description', label: 'Job Type', get: (j) => j.job_description ?? '' },
  { key: 'priority', label: 'Priority', get: (j) => (j.priority ? j.priority.charAt(0).toUpperCase() + j.priority.slice(1) : '') },
  { key: 'skills', label: 'Skills', get: (j) => (j.required_skills ?? []).join(', ') },
  {
    key: 'status',
    label: 'Status',
    get: (j) => (j.status ? (JOB_STATUS_DISPLAY[j.status]?.label ?? j.status) : ''),
  },
  { key: 'status_set_at', label: 'Status set at', get: (j) => formatDateTimeForExport(j.status_set_at) },
  { key: 'worker_name', label: 'Assigned To', get: (j) => j.worker_name ?? 'Unassigned' },
  { key: 'scheduled_date', label: 'Scheduled Date', get: (j) => formatDateForExport(j.scheduled_date) },
  { key: 'created_at', label: 'Created', get: (j) => formatDateTimeForExport(j.created_at) },
  { key: 'start_time', label: 'Start Time', get: (j) => formatDateTimeForExport(j.started_at ?? j.arrived_at) },
  { key: 'completed_at', label: 'Completed at', get: (j) => formatDateTimeForExport(j.completed_at) },
  { key: 'completion_notes', label: 'Completion Notes', get: (j) => j.completion_notes ?? '' },
];

/** Which export column(s) carry what each table column shows. */
const TABLE_TO_EXPORT: Record<JobsListColumnKey, string[]> = {
  customer: ['customer_name'],
  address: ['address'],
  postcode: ['postcode'],
  worker: ['worker_name'],
  scheduled: ['scheduled_date'],
  priority: ['priority'],
  status: ['status'],
  skills: ['skills'],
  created_at: ['created_at'],
  from_partner: [],
};

/** Always on, however the table is set up: the job's reference and when its status was set. */
const ALWAYS_ON: string[] = ['reference_number', 'status_set_at'];

/** The export columns to tick when the dialog opens, given the ids of the columns the table shows. */
export function exportKeysForTable(visibleColumnIds: Iterable<string>): Set<string> {
  const keys = new Set<string>(ALWAYS_ON);
  for (const id of visibleColumnIds) {
    for (const key of TABLE_TO_EXPORT[id as JobsListColumnKey] ?? []) keys.add(key);
  }
  return keys;
}

/** The field groups to tick when the dialog opens: the ones the table shows as a column. */
export function groupIdsForTable(visibleColumnIds: Iterable<string>, groups: FieldGroup[]): Set<string> {
  const visible = new Set(visibleColumnIds);
  return new Set(groups.filter((g) => visible.has(`fg:${g.id}`)).map((g) => g.id));
}

export type CustomAmount = { ok: true; count: number } | { ok: false; error: string };

/** The "Custom amount" box: a whole number from 1 up to what the export can hold. Never silently "everything". */
export function parseCustomAmount(raw: string, max: number): CustomAmount {
  const limit = Math.max(1, Math.floor(max));
  const text = raw.trim();
  const count = Number(text);
  if (text === '' || !Number.isInteger(count) || count < 1 || count > limit) {
    return { ok: false, error: `Enter a whole number from 1 to ${limit.toLocaleString()}.` };
  }
  return { ok: true, count };
}

function sourceFieldKeys(rows: ExportableRow[]): string[] {
  const keys = new Set<string>();
  for (const job of rows) {
    for (const key of Object.keys(job.source_fields ?? {})) {
      if (key.trim()) keys.add(key);
    }
  }
  return [...keys].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export type SheetModel = { headers: string[]; records: Record<string, string>[] };

/**
 * One customer's tab. `groups` are the field groups the owner ticked: each becomes one column (only when some
 * job in this tab has a value for it) and its raw headers are left out so nothing appears twice. Groups that were
 * not ticked leave their raw headers in, as before. Remaining spreadsheet headers follow, sorted.
 */
export function buildSheetModel(
  rows: ExportableRow[],
  systemColumns: typeof EXPORT_COLUMNS,
  groups: Array<Pick<FieldGroup, 'id' | 'name' | 'aliases'>> = [],
): SheetModel {
  const taken = new Set(systemColumns.map((c) => c.label));
  const groupAliases = new Set(groups.flatMap((g) => g.aliases));
  const sourceKeys = sourceFieldKeys(rows).filter((key) => !groupAliases.has(key));
  const rawKeys = new Set(sourceKeys);

  const usedGroups = groups.filter((g) => rows.some((job) => valueForFieldGroup(g, job.source_fields) !== ''));
  const groupHeaders = usedGroups.map((g) => (taken.has(g.name) || rawKeys.has(g.name) ? `Field: ${g.name}` : g.name));
  const groupHeaderSet = new Set(groupHeaders);
  const sourceHeaders = sourceKeys.map((key) =>
    taken.has(key) || groupHeaderSet.has(key) ? `Field: ${key}` : key,
  );

  const headers = [...systemColumns.map((c) => c.label), ...groupHeaders, ...sourceHeaders];
  const records = rows.map((job) => {
    const record: Record<string, string> = {};
    for (const col of systemColumns) record[col.label] = col.get(job);
    usedGroups.forEach((g, i) => {
      record[groupHeaders[i]!] = valueForFieldGroup(g, job.source_fields);
    });
    const fields = job.source_fields ?? {};
    sourceKeys.forEach((key, i) => {
      record[sourceHeaders[i]!] = fields[key] ?? '';
    });
    return record;
  });
  return { headers, records };
}
