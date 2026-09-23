'use server';

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { GROUPING_AI_MODEL, supportsEffort } from '@/lib/ai/model';
import { logStructuredAiInteraction } from '@/lib/services/ai-interaction-log';
import { resolveGroupingColumns } from '@/lib/import/job-grouping';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

/** Rows shown to the model. Enough to see repetition; small enough to be cheap. */
const SAMPLE_ROW_LIMIT = 40;
/** Same transient failures the row extraction retries (rate limit, grammar compile timeout). */
const MAX_ATTEMPTS = 3;

function isRetryable(e: unknown): boolean {
  if (
    e instanceof Anthropic.RateLimitError ||
    e instanceof Anthropic.APIConnectionError ||
    e instanceof Anthropic.InternalServerError
  ) {
    return true;
  }
  return (
    e instanceof Anthropic.APIError &&
    /grammar compilation/i.test(String((e as { message?: unknown }).message ?? ''))
  );
}

async function callWithRetry<T>(call: () => Promise<T>): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await call();
    } catch (e) {
      if (!isRetryable(e)) throw e;
      lastError = e;
    }
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

const SYSTEM_PROMPT = `You look at a UK field-service job spreadsheet and decide which columns, if any, identify a set of rows that one worker should be sent to together as a single run (one visit / one stop / one day-run unit).

This is trade-agnostic. Different sheets use different keys for "travel together":
- Same escort / warrant officer / engineer name (+ contact) on the same calendar day, across different addresses
- Same property / site (address, postcode, building or BR reference), possibly same day
- Same client visit or estate / round stop reference

Rules:
- Pick the smallest set of columns that reliably distinguishes one run from another.
- Include a calendar-date column when the same person or site recurs on different days, so each day is its own group. Prefer a date-only column over a date+time column (times rarely match across jobs on the same visit).
- Address and postcode ARE allowed when they identify the site the worker should do together. Do not ban them.
- Do NOT pick columns that describe the individual job attribute rather than the visit: lock/job/service type, notes, comments, free-text descriptions, Y/N flags, shutter flags, empty/__EMPTY columns, or columns that are the same on every row (client company name).
- Do NOT pick a job reference / our-ref / unique id that differs on every row.
- Propose columns from the headers even when this sample looks like a flat list with no obvious clusters or blank-row separators. Flat lists still group when values match.
- Only return an empty list when no column set could plausibly mean "one run for one worker."
- Use the column headers exactly as given.`;

const SuggestionSchema = z.object({
  grouping_columns: z
    .array(z.string())
    .describe('Column headers, verbatim, whose matching values define one run. [] if none.'),
  reason: z
    .string()
    .describe(
      'One short sentence for the user explaining the choice, e.g. "Same officer and date are one visit." or "Same address and postcode are one site."'
    ),
});

export type GroupingSuggestion = {
  columns: string[];
  /** Where the columns came from — drives the wizard copy. */
  source: 'saved' | 'ai' | 'none';
  reason: string | null;
};

export type SuggestGroupingResult =
  | { success: true; suggestion: GroupingSuggestion }
  | { success: false; error: string };

function formatSample(headers: string[], rows: Record<string, string>[]): string {
  const lines = rows.map((row, i) => {
    const cells = headers
      .map((h) => {
        const v = String(row[h] ?? '').replace(/\s+/g, ' ').trim();
        return v ? `${h}: ${v}` : null;
      })
      .filter((c): c is string => c != null);
    return `Row ${i + 1}: ${cells.join(' | ') || '(empty)'}`;
  });
  return `Columns: ${headers.join(', ')}\n\n${lines.join('\n')}`;
}

function normalizeCell(value: string | undefined): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Headers that often repeat but are job attributes, not a visit key.
 * Dropped after the model answers so lock type / notes cannot win.
 */
function isJobSpecHeader(header: string): boolean {
  const h = header.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!h || h.startsWith('__empty')) return true;
  if (
    /^(lock\s*type|locktype|shutters?|notes?|special notes|comments?|description|y\/n|yes\/no|flag)$/.test(
      h
    )
  ) {
    return true;
  }
  if (/lock\s*type|special\s*notes|job\s*notes|engineer\s*notes|service\s*type|job\s*type/.test(h)) {
    return true;
  }
  return false;
}

/**
 * Keep only real headers that could be a visit key on this sheet:
 * drop junk / job-spec names, all-blank, constant-across-all-rows, and
 * unique-per-row ids. Address is allowed when it actually repeats.
 */
export function sanitizeGroupingColumns(
  proposed: readonly string[],
  headers: readonly string[],
  rows: readonly Record<string, string>[]
): string[] {
  const resolved = resolveGroupingColumns(proposed, headers);
  return resolved.filter((col) => {
    if (isJobSpecHeader(col)) return false;
    const values = rows.map((r) => normalizeCell(r[col])).filter((v) => v !== '');
    if (values.length === 0) return false;
    const unique = new Set(values);
    // Same value on every filled row → client name / single flag, not a visit.
    if (unique.size === 1 && values.length === rows.length) return false;
    // Every filled value unique → job ref / our-ref, not a shared visit.
    if (unique.size === values.length) return false;
    return true;
  });
}

/**
 * Grouping columns for this customer's sheets. Returns the saved choice when
 * the import source has one (including [] = grouping switched off); otherwise
 * asks the model once and sanitises the answer. Nothing is saved here —
 * importJobs persists whatever the user confirms.
 */
export async function suggestGroupingColumns(params: {
  customerId: string;
  headers: string[];
  rows: Record<string, string>[];
}): Promise<SuggestGroupingResult> {
  const headers = params.headers.filter((h) => h.trim() !== '');
  if (headers.length === 0 || params.rows.length < 2) {
    return { success: true, suggestion: { columns: [], source: 'none', reason: null } };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return { success: false, error: 'Not authenticated' };

  const { data: userRow } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single();
  const tenantId = userRow?.tenant_id;
  if (!tenantId) return { success: false, error: 'No tenant assigned.' };

  const { data: source } = await supabase
    .from('import_sources')
    .select('id, grouping_columns')
    .eq('tenant_id', tenantId)
    .eq('customer_id', params.customerId)
    .eq('is_active', true)
    .order('last_used_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (source && Array.isArray(source.grouping_columns)) {
    const saved = (source.grouping_columns as unknown[]).filter(
      (c): c is string => typeof c === 'string'
    );
    return {
      success: true,
      suggestion: {
        columns: resolveGroupingColumns(saved, headers),
        source: 'saved',
        reason: null,
      },
    };
  }

  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return { success: true, suggestion: { columns: [], source: 'none', reason: null } };
  }

  const sample = params.rows.slice(0, SAMPLE_ROW_LIMIT);
  const userPrompt = `Which columns identify rows that one worker should do together?\n\n${formatSample(headers, sample)}`;
  const startedAt = Date.now();

  try {
    const response = await callWithRetry(() =>
      anthropic.messages.parse({
        model: GROUPING_AI_MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
        output_config: {
          ...(supportsEffort(GROUPING_AI_MODEL) ? { effort: 'low' as const } : {}),
          format: zodOutputFormat(SuggestionSchema),
        },
      })
    );

    const parsed = response.parsed_output;
    // Model proposes; sanitise against the full sheet (not only the sample) so
    // repeats past row 40 still count, and job-spec columns cannot win.
    const columns = parsed
      ? sanitizeGroupingColumns(parsed.grouping_columns, headers, params.rows)
      : [];

    await logStructuredAiInteraction(supabase, {
      tenantId,
      interactionType: 'column_mapping',
      prompt: userPrompt,
      inputData: { purpose: 'job_grouping', headers, sample_rows: sample.length },
      parsedOutput: {
        proposed: parsed?.grouping_columns ?? [],
        accepted: columns,
      },
      model: GROUPING_AI_MODEL,
      tokensInput: response.usage.input_tokens,
      tokensOutput: response.usage.output_tokens,
      latencyMs: Date.now() - startedAt,
      importSourceId: source?.id ?? null,
    });

    return {
      success: true,
      suggestion: {
        columns,
        source: columns.length > 0 ? 'ai' : 'none',
        reason: columns.length > 0 ? (parsed?.reason?.trim() || null) : null,
      },
    };
  } catch (e) {
    console.error('[suggestGroupingColumns]', e);
    // Grouping is optional — a failed suggestion must never block the import.
    return { success: true, suggestion: { columns: [], source: 'none', reason: null } };
  }
}
