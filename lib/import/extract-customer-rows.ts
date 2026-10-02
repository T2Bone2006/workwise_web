'use server';

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { createClient } from '@/lib/supabase/server';
import { CUSTOMER_IMPORT_AI_MODEL, supportsEffort } from '@/lib/ai/model';
import { logStructuredAiInteraction } from '@/lib/services/ai-interaction-log';
import { customerSheetSystemPrompt } from '@/lib/import/customer-extraction-prompt';
import {
  CustomerExtractionBatchSchema,
  blankExtractedCustomerRow,
  type ExtractedCustomerRow,
} from '@/lib/import/extracted-customer-row';
import { todayInLondon } from '@/lib/rounds/dates';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { usesRoundsCrm } from '@/lib/navigation/dashboard-paths';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

function formatRowsForPrompt(rows: Array<{ rowIndex: number; row: Record<string, string> }>): string {
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

/** Attempts before a batch falls back to unconstrained JSON. */
const MAX_EXTRACTION_ATTEMPTS = 3;

function isRetryableExtractionError(e: unknown): boolean {
  if (
    e instanceof Anthropic.RateLimitError ||
    e instanceof Anthropic.APIConnectionError ||
    e instanceof Anthropic.InternalServerError
  ) {
    return true;
  }
  // "Grammar compilation timed out" is a transient 400 the SDK never retries.
  return (
    e instanceof Anthropic.APIError &&
    /grammar compilation/i.test(String((e as { message?: unknown }).message ?? ''))
  );
}

const FALLBACK_JSON_INSTRUCTION = `Return ONLY a JSON object of the form {"customers": [...]}, one entry per input row, each with exactly these keys:
row_index (number), is_customer_row (boolean), and these strings ("" when absent): name, phone, email, address, postcode, service, price, frequency, preferred_weekday, last_visit_date, next_visit_date, balance_owed, status, access_notes, notes.
No markdown, no commentary.`;

type ExtractionCall = { customers: ExtractedCustomerRow[]; tokensInput: number; tokensOutput: number };

/**
 * Constrained decoding first, plain JSON as the backstop (same shape as the
 * Pro job reader). `prepareExtractedCustomerRow` still validates every field
 * before anything reaches the database.
 */
async function runExtractionCall(systemPrompt: string, userPrompt: string): Promise<ExtractionCall> {
  const effort = supportsEffort(CUSTOMER_IMPORT_AI_MODEL) ? { effort: 'low' as const } : {};
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_EXTRACTION_ATTEMPTS; attempt += 1) {
    try {
      const response = await anthropic.messages.parse({
        model: CUSTOMER_IMPORT_AI_MODEL,
        max_tokens: 16000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        output_config: { ...effort, format: zodOutputFormat(CustomerExtractionBatchSchema) },
      });
      if (response.parsed_output) {
        return {
          customers: response.parsed_output.customers,
          tokensInput: response.usage.input_tokens,
          tokensOutput: response.usage.output_tokens,
        };
      }
      lastError = new Error('Model returned no parseable output');
    } catch (e) {
      if (!isRetryableExtractionError(e)) throw e;
      lastError = e;
    }
    if (attempt < MAX_EXTRACTION_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
    }
  }

  console.warn('[extractCustomerRowsBatch] constrained decoding unavailable, falling back to JSON', lastError);

  const response = await anthropic.messages.create({
    model: CUSTOMER_IMPORT_AI_MODEL,
    max_tokens: 16000,
    system: systemPrompt,
    messages: [{ role: 'user', content: `${userPrompt}\n\n${FALLBACK_JSON_INSTRUCTION}` }],
    output_config: effort,
  });

  const text = response.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');

  const parsed = CustomerExtractionBatchSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error('AI returned these rows in an unreadable shape');
  return {
    customers: parsed.data.customers,
    tokensInput: response.usage.input_tokens,
    tokensOutput: response.usage.output_tokens,
  };
}

export type ExtractCustomerRowsResult =
  | { success: true; rows: ExtractedCustomerRow[] }
  | { success: false; error: string };

/**
 * Read one batch of spreadsheet rows into customers. The client chunks the
 * sheet and calls this per batch so it can show real progress; `startIndex` is
 * the sheet-wide index of `rows[0]`. The AI sees only the rows — no tenant data
 * — and the log keeps row indexes and the file name, never cell contents.
 */
export async function extractCustomerRowsBatch(params: {
  rows: Record<string, string>[];
  startIndex: number;
  fileName: string;
}): Promise<ExtractCustomerRowsResult> {
  const { rows, startIndex, fileName } = params;
  if (rows.length === 0) return { success: true, rows: [] };

  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return { success: false, error: 'AI import is not configured (missing API key).' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return { success: false, error: 'Not authenticated' };

  const { data: userRow } = await supabase.from('users').select('tenant_id').eq('id', user.id).single();
  const tenantId = userRow?.tenant_id;
  if (!tenantId) return { success: false, error: 'No tenant assigned.' };

  const products = await getTenantProducts();
  if (!usesRoundsCrm(products)) return { success: false, error: 'Imports are part of Rounds.' };

  const indexed = rows.map((row, i) => ({ rowIndex: startIndex + i, row }));
  const userPrompt = `Read one customer from each of these ${rows.length} spreadsheet rows.\n\n${formatRowsForPrompt(indexed)}`;
  const systemPrompt = customerSheetSystemPrompt(todayInLondon());
  const startedAt = Date.now();

  try {
    const call = await runExtractionCall(systemPrompt, userPrompt);

    // Key by row_index — never trust array position.
    const byIndex = new Map<number, ExtractedCustomerRow>();
    for (const customer of call.customers) byIndex.set(customer.row_index, customer);

    // One row out per row in; a row the model skipped becomes a blank that
    // fails validation loudly instead of vanishing.
    const extracted = indexed.map(
      ({ rowIndex }) => byIndex.get(rowIndex) ?? blankExtractedCustomerRow(rowIndex)
    );

    await logStructuredAiInteraction(supabase, {
      tenantId,
      interactionType: 'customer_row_extraction',
      prompt: 'customer_row_extraction (row contents not logged)',
      inputData: { row_count: rows.length, start_index: startIndex, file_name: fileName },
      parsedOutput: { row_count: call.customers.length },
      model: CUSTOMER_IMPORT_AI_MODEL,
      tokensInput: call.tokensInput,
      tokensOutput: call.tokensOutput,
      latencyMs: Date.now() - startedAt,
    });

    return { success: true, rows: extracted };
  } catch (e) {
    console.error('[extractCustomerRowsBatch]', e instanceof Error ? e.name : 'error');
    if (e instanceof Anthropic.RateLimitError) {
      return { success: false, error: 'AI is rate limited right now — try again in a moment.' };
    }
    if (e instanceof Anthropic.APIConnectionError) {
      return { success: false, error: 'Could not reach the AI service. Check your connection.' };
    }
    if (e instanceof SyntaxError) {
      return { success: false, error: 'AI returned these rows in an unreadable shape.' };
    }
    return { success: false, error: 'Could not read the spreadsheet rows.' };
  }
}
