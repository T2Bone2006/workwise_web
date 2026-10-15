/**
 * The questions a business asks when an engineer finishes a job.
 * Stored on `tenants.settings.job_report_fields`. The phone, the job page,
 * and the outcome email all read this list.
 *
 * Yes/No and dropdowns are always answered when they are on screen. A write-in
 * is answered only when `required` is true, or when it explains an answer that
 * stops the job counting as completed. `blocks_completion` is that second
 * switch: the form is still submitted, and the job is stored as not completed.
 */

export const MAX_JOB_REPORT_FIELDS = 40;
export const MAX_OPTIONS = 12;
const MAX_LABEL = 140;
const MAX_OPTION = 80;

const RESERVED_IDS = new Set([
  'job_completed',
  'incomplete_reason',
  'job_notes',
  'pause_reason',
  'walked_away',
]);

export type JobReportAnswerType = 'yes_no' | 'select' | 'text';

export interface JobReportShowWhen {
  field: string;
  value: boolean | string;
}

export interface JobReportField {
  id: string;
  label: string;
  type: JobReportAnswerType;
  options: string[];
  multiline: boolean;
  /** A write-in that must be filled in. Never set on a Yes/No or a dropdown. */
  required: boolean;
  blocksCompletion: boolean;
  /**
   * Which answer marks the job as not completed. A dropdown names one of its
   * choices. A Yes/No stores false for "No"; null on a Yes/No means Yes.
   */
  blockingValue: boolean | string | null;
  showWhen: JobReportShowWhen | null;
}

export interface JobReportFieldInput {
  id?: string | null;
  label: string;
  type: string;
  options?: string[];
  multiline?: boolean;
  required?: boolean;
  blocksCompletion?: boolean;
  blockingValue?: boolean | string | null;
  showWhen?: { field: string; value: boolean | string } | null;
}

export type JobReportFieldsResult =
  | { ok: true; fields: JobReportField[] }
  | { ok: false; error: string };

export interface AnswerChoice {
  label: string;
  value: boolean | string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanId(value: string): string {
  return value.trim();
}

function slugFromLabel(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return slug || 'question';
}

export function answerChoices(field: Pick<JobReportField, 'type' | 'options'>): AnswerChoice[] {
  if (field.type === 'yes_no') {
    return [
      { label: 'Yes', value: true },
      { label: 'No', value: false },
    ];
  }
  if (field.type === 'select') {
    return field.options.map((option) => ({ label: option, value: option }));
  }
  return [];
}

/** The answer that marks the job as not completed, or null when none does. */
export function blockingAnswerOf(
  field: Pick<JobReportField, 'type' | 'blocksCompletion' | 'blockingValue'>
): boolean | string | null {
  if (!field.blocksCompletion) return null;
  if (field.type === 'yes_no') return field.blockingValue === false ? false : true;
  if (field.type === 'select') return typeof field.blockingValue === 'string' ? field.blockingValue : null;
  return null;
}

export function formatShowWhenValue(value: boolean | string): string {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return value;
}

/** Reads stored settings, dropping a broken entry rather than throwing. */
export function parseJobReportFields(raw: unknown): JobReportField[] {
  if (!Array.isArray(raw)) return [];
  const fields: JobReportField[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    const record = asRecord(item);
    const id = typeof record.id === 'string' ? cleanId(record.id) : '';
    const label = typeof record.label === 'string' ? record.label.trim() : '';
    const type = record.type;
    if (!id || !label || seen.has(id)) continue;
    if (type !== 'yes_no' && type !== 'select' && type !== 'text') continue;
    seen.add(id);

    const options =
      type === 'select' && Array.isArray(record.options)
        ? record.options.filter((option): option is string => typeof option === 'string' && option.trim() !== '').map((option) => option.trim())
        : [];

    const showWhenRecord = asRecord(record.show_when);
    const showField = typeof showWhenRecord.field === 'string' ? showWhenRecord.field : '';
    const showValue = showWhenRecord.value;
    const showWhen =
      showField && (typeof showValue === 'boolean' || typeof showValue === 'string')
        ? { field: showField, value: showValue }
        : null;

    const blockingRaw = record.blocking_value;
    const blockingValue =
      type === 'select'
        ? typeof blockingRaw === 'string' && blockingRaw.trim()
          ? blockingRaw.trim()
          : null
        : type === 'yes_no' && blockingRaw === false
          ? false
          : null;

    fields.push({
      id,
      label,
      type,
      options,
      multiline: type === 'text' && record.multiline === true,
      required: type === 'text' && record.required === true,
      blocksCompletion: record.blocks_completion === true && type !== 'text',
      blockingValue,
      showWhen,
    });
  }

  return fields;
}

export function serialiseJobReportFields(fields: JobReportField[]): unknown[] {
  return fields.map((field) => {
    const out: Record<string, unknown> = {
      id: field.id,
      type: field.type,
      label: field.label,
    };
    if (field.type === 'select') out.options = field.options;
    if (field.type === 'text' && field.multiline) out.multiline = true;
    if (field.type === 'text' && field.required) out.required = true;
    if (field.blocksCompletion && field.type !== 'text') {
      out.blocks_completion = true;
      if (field.type === 'select' && field.blockingValue) out.blocking_value = field.blockingValue;
      if (field.type === 'yes_no' && field.blockingValue === false) out.blocking_value = false;
    }
    if (field.showWhen) out.show_when = field.showWhen;
    return out;
  });
}

function freshId(label: string, taken: Set<string>): string {
  const base = slugFromLabel(label);
  let id = RESERVED_IDS.has(base) ? `${base}_question` : base;
  let n = 2;
  while (taken.has(id) || RESERVED_IDS.has(id)) {
    id = `${base}_${n}`;
    n += 1;
  }
  return id;
}

/**
 * Checks an edit from the settings screen. An existing id is kept, so renaming
 * the wording does not orphan answers already stored on jobs.
 */
export function normaliseJobReportFields(input: JobReportFieldInput[]): JobReportFieldsResult {
  if (input.length > MAX_JOB_REPORT_FIELDS) {
    return { ok: false, error: `You can have up to ${MAX_JOB_REPORT_FIELDS} questions.` };
  }

  const fields: JobReportField[] = [];
  const taken = new Set<string>();

  for (const item of input) {
    const label = item.label.trim();
    if (!label) return { ok: false, error: 'A question needs wording.' };
    if (label.length > MAX_LABEL) {
      return { ok: false, error: `Question wording can be at most ${MAX_LABEL} characters.` };
    }
    if (item.type !== 'yes_no' && item.type !== 'select' && item.type !== 'text') {
      return { ok: false, error: 'Choose Yes/No, a dropdown, or a text box.' };
    }

    const options =
      item.type === 'select'
        ? (item.options ?? []).map((option) => option.trim()).filter(Boolean)
        : [];
    if (item.type === 'select') {
      if (options.length < 2) return { ok: false, error: 'A dropdown needs at least two choices.' };
      if (options.length > MAX_OPTIONS) {
        return { ok: false, error: `A dropdown can have up to ${MAX_OPTIONS} choices.` };
      }
      if (options.some((option) => option.length > MAX_OPTION)) {
        return { ok: false, error: `A choice can be at most ${MAX_OPTION} characters.` };
      }
      if (new Set(options).size !== options.length) {
        return { ok: false, error: 'A dropdown can’t list the same choice twice.' };
      }
    }

    if (item.blocksCompletion && item.type === 'text') {
      return { ok: false, error: 'A text question can’t mark the job as not completed.' };
    }

    let blockingValue: boolean | string | null = null;
    if (item.blocksCompletion && item.type === 'select') {
      const chosen = typeof item.blockingValue === 'string' ? item.blockingValue.trim() : '';
      if (!options.includes(chosen)) {
        return { ok: false, error: 'Choose which answer marks the job as not completed.' };
      }
      blockingValue = chosen;
    }
    if (item.blocksCompletion && item.type === 'yes_no' && item.blockingValue === false) {
      blockingValue = false;
    }

    let showWhen: JobReportShowWhen | null = null;
    if (item.showWhen) {
      const parent = fields.find((field) => field.id === item.showWhen?.field);
      if (!parent) {
        return {
          ok: false,
          error: 'A follow-up has to depend on a question above it.',
        };
      }
      const choices = answerChoices(parent);
      if (choices.length === 0) {
        return { ok: false, error: 'A follow-up can’t depend on a text question.' };
      }
      const match = choices.find((choice) => choice.value === item.showWhen?.value);
      if (!match) return { ok: false, error: 'Choose which answer shows this question.' };
      showWhen = { field: parent.id, value: match.value };
    }

    const requested = item.id?.trim() ?? '';
    let id = requested;
    if (!id) {
      id = freshId(label, taken);
    } else if (RESERVED_IDS.has(id)) {
      return { ok: false, error: `“${label}” uses a name the finish form already keeps for itself.` };
    } else if (taken.has(id)) {
      return { ok: false, error: 'Two questions can’t share the same id.' };
    }
    taken.add(id);

    fields.push({
      id,
      label,
      type: item.type,
      options,
      multiline: item.type === 'text' && item.multiline === true,
      required: item.type === 'text' && item.required === true,
      blocksCompletion: item.blocksCompletion === true && item.type !== 'text',
      blockingValue,
      showWhen,
    });
  }

  return { ok: true, fields };
}

export interface JobReportBranch {
  label: string;
  value: boolean | string;
  fields: JobReportNode[];
}

/** One question, with the follow-ups that hang off each of its answers. */
export interface JobReportNode {
  field: JobReportField;
  branches: JobReportBranch[];
}

/**
 * The shape an admin should see: a follow-up sits under the answer that
 * reveals it, in the same order the engineer meets them.
 */
export function jobReportTree(fields: JobReportField[]): JobReportNode[] {
  const ids = new Set(fields.map((field) => field.id));
  const seen = new Set<string>();

  const nodeFor = (field: JobReportField): JobReportNode => {
    seen.add(field.id);
    const branches = answerChoices(field)
      .map((choice) => ({
        label: choice.label,
        value: choice.value,
        fields: fields
          .filter(
            (child) =>
              child.showWhen?.field === field.id &&
              child.showWhen.value === choice.value &&
              !seen.has(child.id)
          )
          .map(nodeFor),
      }))
      .filter((branch) => branch.fields.length > 0);
    return { field, branches };
  };

  const roots: JobReportNode[] = [];
  for (const field of fields) {
    if (seen.has(field.id)) continue;
    const parentId = field.showWhen?.field;
    if (parentId && ids.has(parentId)) continue;
    roots.push(nodeFor(field));
  }
  return roots;
}

export function flattenJobReportTree(nodes: JobReportNode[]): JobReportField[] {
  const out: JobReportField[] = [];
  const walk = (node: JobReportNode) => {
    out.push(node.field);
    for (const branch of node.branches) {
      for (const child of branch.fields) walk(child);
    }
  };
  for (const node of nodes) walk(node);
  return out;
}

export interface EditedChoice {
  text: string;
  /** The stored answer this choice came from: a dropdown's old wording, or true/false from a Yes/No. */
  from: boolean | string | null;
}

/**
 * When a question is reworded, given new choices or a new answer type, which
 * answer each existing follow-up should now hang off. Null means the answer it
 * hung off is gone.
 */
export function followUpAnswerAfterEdit(
  previous: boolean | string,
  original: Pick<JobReportField, 'type'>,
  next: { type: JobReportAnswerType; choices: EditedChoice[] }
): boolean | string | null {
  if (next.type === 'text') return null;
  if (next.type === 'yes_no') {
    if (original.type === 'yes_no') return typeof previous === 'boolean' ? previous : null;
    const choice = next.choices.find((item) => item.from === previous);
    const wording = (choice ? choice.text : String(previous)).trim().toLowerCase();
    if (wording === 'yes') return true;
    if (wording === 'no') return false;
    return null;
  }
  const kept = next.choices.find((item) => item.from === previous && item.text.trim());
  if (kept) return kept.text.trim();
  if (typeof previous === 'boolean') {
    const wanted = previous ? 'yes' : 'no';
    const match = next.choices.find((item) => item.text.trim().toLowerCase() === wanted);
    return match ? match.text.trim() : null;
  }
  return null;
}

/** Where a new follow-up should sit so it stays with the answer that shows it. */
export function followUpInsertIndex(
  fields: JobReportField[],
  parentId: string,
  value: boolean | string
): number {
  const descendants = new Set<string>();
  const add = (id: string) => {
    for (const field of fields) {
      if (field.showWhen?.field !== id || descendants.has(field.id)) continue;
      if (id === parentId && field.showWhen.value !== value) continue;
      descendants.add(field.id);
      add(field.id);
    }
  };
  add(parentId);

  let insertAt = fields.findIndex((field) => field.id === parentId) + 1;
  fields.forEach((field, index) => {
    if (descendants.has(field.id)) insertAt = index + 1;
  });
  return insertAt;
}
