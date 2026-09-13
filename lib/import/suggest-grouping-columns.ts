'use server';

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { GROUPING_AI_MODEL, supportsEffort } from '@/lib/ai/model';
import { logStructuredAiInteraction } from '@/lib/services/ai-interaction-log';
import { computeRowGroups, resolveGroupingColumns } from '@/lib/import/job-grouping';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

/** Rows shown to the model. Enough to see repetition; small enough to be cheap. */
const SAMPLE_ROW_LIMIT = 40;

const SYSTEM_PROMPT = `You look at a UK field-service job spreadsheet and decide which columns, if any, identify a set of rows that one worker should be sent to together as a single run.

Typical signals: several rows share the same escort/officer/engineer name and contact number, the same site or building, or the same client visit reference, on the same date — and each such set should go to one worker so they can travel together.

Rules:
- Pick the smallest set of columns that reliably distinguishes one run from another. Include a date column when the same person/site recurs on different days.
- Do NOT pick columns that describe the individual job (address, postcode, job reference, lock type, notes) or that are the same on every row (client name, "Y/N" flags with one value).
- Only propose grouping when the sample actually contains at least one set of two or more rows that agree on every proposed column. If rows look independent, return an empty list.
- Use the column headers exactly as given.`;

const SuggestionSchema = z.object({
  grouping_columns: z
    .array(z.string())
    .describe('Column headers, verbatim, whose matching values define one run. [] if none.'),
  reason: z
    .string()
    .describe('One short sentence for the user explaining the choice, e.g. "Rows with the same officer and date are one visit."'),
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

/**
 * Grouping columns for this customer's sheets. Returns the saved choice when
 * the import source has one (including [] = grouping switched off); otherwise
 * asks the model once and validates the answer against the actual rows.
 * Nothing is saved here — importJobs persists whatever the user confirms.
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
    const response = await anthropic.messages.parse({
      model: GROUPING_AI_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
      output_config: {
        ...(supportsEffort(GROUPING_AI_MODEL) ? { effort: 'low' as const } : {}),
        format: zodOutputFormat(SuggestionSchema),
      },
    });

    const parsed = response.parsed_output;
    // The model proposes; the rows dispose. Keep only real headers, and only
    // if applying them actually yields a group in the sample.
    let columns = parsed ? resolveGroupingColumns(parsed.grouping_columns, headers) : [];
    if (columns.length > 0 && computeRowGroups(sample, columns).length === 0) {
      columns = [];
    }

    await logStructuredAiInteraction(supabase, {
      tenantId,
      interactionType: 'column_mapping',
      prompt: userPrompt,
      inputData: { purpose: 'job_grouping', headers, sample_rows: sample.length },
      parsedOutput: { proposed: parsed?.grouping_columns ?? [], accepted: columns },
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
