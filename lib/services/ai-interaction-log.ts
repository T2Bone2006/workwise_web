/**
 * Shared ai_interactions logging for structured-output calls.
 *
 * Not a 'use server' module: callers already hold a Supabase client and the
 * tenant id, so passing them in avoids a second auth + tenant round trip per
 * AI call. `callAIWithLogging` remains the path for plain text completions.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { estimateAiCostUsd } from '@/lib/ai/model';

export type StructuredAiLogParams = {
  tenantId: string;
  interactionType: 'row_extraction' | 'skill_detection';
  prompt: string;
  inputData: Record<string, unknown>;
  parsedOutput: unknown;
  model: string;
  tokensInput: number;
  tokensOutput: number;
  latencyMs: number;
  importSourceId?: string | null;
};

export async function logStructuredAiInteraction(
  supabase: SupabaseClient,
  params: StructuredAiLogParams
): Promise<void> {
  const { error } = await supabase.from('ai_interactions').insert({
    tenant_id: params.tenantId,
    interaction_type: params.interactionType,
    input_prompt: params.prompt,
    input_data: params.inputData,
    ai_response: JSON.stringify(params.parsedOutput),
    parsed_output: params.parsedOutput,
    model: params.model,
    provider: 'anthropic',
    tokens_input: params.tokensInput,
    tokens_output: params.tokensOutput,
    tokens_total: params.tokensInput + params.tokensOutput,
    latency_ms: params.latencyMs,
    cost_usd: estimateAiCostUsd(params.model, params.tokensInput, params.tokensOutput),
    accepted: true,
    import_source_id: params.importSourceId ?? null,
    environment: process.env.NODE_ENV || 'production',
  });
  if (error) {
    console.error(`[logStructuredAiInteraction:${params.interactionType}]`, error);
  }
}
