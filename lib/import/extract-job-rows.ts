'use server';

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { createClient } from '@/lib/supabase/server';
import { EXTRACTION_AI_MODEL, supportsEffort } from '@/lib/ai/model';
import { logStructuredAiInteraction } from '@/lib/services/ai-interaction-log';
import {
  ExtractionBatchSchema,
  type ExtractedJobRow,
} from '@/lib/import/extracted-job-row';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const SYSTEM_PROMPT = `You turn rows of a UK field-service job spreadsheet into structured jobs.

You see every column of each row at once, so you can combine or split columns as needed:
- A single cell like "08/09/2026 09:00" holds BOTH a date and a start time — split it.
- A "...START" / "...FINISH" (or from/to) pair of columns gives start_time and end_time; both usually repeat the same date, which you report once in scheduled_date.
- A postcode may sit inside the address cell rather than its own column — pull it out and still return the street part in address.
- Several columns may together describe the work; combine them into the description rather than dumping the cells verbatim.

Rules:
- Dates are UK day-first when ambiguous: 01/02/2026 is 1 February 2026. Always output scheduled_date as YYYY-MM-DD.
- Times are 24-hour HH:MM. "9am" is 09:00, "2.30pm" is 14:30.
- Never invent a value. If the row genuinely does not contain a field, return "" for it (or "unknown" for job_length, "normal" for priority).
- Only set job_length when the row states a half or full day. A start/finish time pair is NOT a job_length — leave it "unknown" and report the times.
- description is a useful briefing for the worker turning up: one or two sentences covering what needs doing plus anything in the row that affects the visit — access or key details, equipment or parts, tenant/contact notes, safety or permit constraints. Prefer completeness over brevity when the row genuinely says more.
- Do not put the address, postcode or reference number in the description (they have their own fields), and never dump raw "column: value" pairs into it.
- Return exactly one job per input row, copying row_index unchanged. Do not skip rows, do not merge rows, do not reorder.`;

function formatRowsForPrompt(
  rows: Array<{ rowIndex: number; row: Record<string, string> }>
): string {
  return rows
    .map(({ rowIndex, row }) => {
      const cells = Object.entries(row)
        .map(([col, val]) => {
          const value = String(val ?? '').trim();
          return value ? `  ${col}: ${value}` : null;
        })
        .filter((line): line is string => line != null);
      return `Row ${rowIndex}:\n${cells.length ? cells.join('\n') : '  (empty row)'}`;
    })
    .join('\n\n');
}

/** Placeholder for a row the model failed to return — always fails validation. */
function missingExtraction(rowIndex: number): ExtractedJobRow {
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

export type ExtractJobRowsResult =
  | { success: true; rows: ExtractedJobRow[] }
  | { success: false; error: string };

/**
 * Extract one batch of spreadsheet rows into structured jobs.
 *
 * The client chunks the sheet and calls this per batch so it can show real
 * progress. `startIndex` is the sheet-wide index of `rows[0]`, so row indices
 * stay stable across batches. Callers run `prepareExtractedRow` to validate —
 * preview does it for display, `importJobs` does it again before writing.
 */
export async function extractJobRowsBatch(params: {
  rows: Record<string, string>[];
  startIndex: number;
  importSourceId?: string | null;
}): Promise<ExtractJobRowsResult> {
  const { rows, startIndex } = params;
  if (rows.length === 0) return { success: true, rows: [] };

  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return { success: false, error: 'AI import is not configured (missing API key).' };
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

  const indexed = rows.map((row, i) => ({ rowIndex: startIndex + i, row }));
  const userPrompt = `Extract one job from each of these ${rows.length} spreadsheet rows.\n\n${formatRowsForPrompt(indexed)}`;
  const startedAt = Date.now();

  try {
    const response = await anthropic.messages.parse({
      model: EXTRACTION_AI_MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
      output_config: {
        // Extraction is structured reading, not hard reasoning — low effort keeps
        // imports fast. Thinking stays adaptive (disabling it misbehaves on Opus 5).
        // Older models 400 on `effort`, so only send it where it is supported.
        ...(supportsEffort(EXTRACTION_AI_MODEL) ? { effort: 'low' as const } : {}),
        format: zodOutputFormat(ExtractionBatchSchema),
      },
    });

    const parsed = response.parsed_output;
    if (!parsed) {
      return { success: false, error: 'AI could not read these rows. Try importing again.' };
    }

    // Key by row_index — never trust array position.
    const byIndex = new Map<number, ExtractedJobRow>();
    for (const job of parsed.jobs) {
      byIndex.set(job.row_index, job);
    }

    // One row out per row in, in sheet order — a row the model skipped becomes a
    // blank extraction, which then fails validation loudly instead of vanishing.
    const extracted = indexed.map(
      ({ rowIndex }) => byIndex.get(rowIndex) ?? missingExtraction(rowIndex)
    );

    await logStructuredAiInteraction(supabase, {
      tenantId,
      interactionType: 'row_extraction',
      prompt: userPrompt,
      inputData: { row_count: rows.length, start_index: startIndex },
      parsedOutput: parsed,
      model: EXTRACTION_AI_MODEL,
      tokensInput: response.usage.input_tokens,
      tokensOutput: response.usage.output_tokens,
      latencyMs: Date.now() - startedAt,
      importSourceId: params.importSourceId,
    });

    return { success: true, rows: extracted };
  } catch (e) {
    console.error('[extractJobRowsBatch]', e);
    if (e instanceof Anthropic.RateLimitError) {
      return { success: false, error: 'AI is rate limited right now — try again in a moment.' };
    }
    if (e instanceof Anthropic.APIConnectionError) {
      return { success: false, error: 'Could not reach the AI service. Check your connection.' };
    }
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Could not read the spreadsheet rows.',
    };
  }
}
