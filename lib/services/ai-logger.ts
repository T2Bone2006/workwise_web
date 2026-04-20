'use server';

import { createClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export interface AICallParams {
  type:
    | 'skill_detection'
    | 'quote_generation'
    | 'column_mapping'
    | 'value_transformation'
    | 'worker_interview_parsing';
  prompt: string;
  inputData: Record<string, unknown>;
  jobId?: string;
  workerId?: string;
  quoteId?: string;
  importSourceId?: string;
  model?: string;
  max_tokens?: number;
}

export interface AICallResult<T> {
  data: T;
  interactionId: string;
  cost: number;
  latency: number;
}

export async function callAIWithLogging<T>(
  params: AICallParams,
  parser: (response: string) => T
): Promise<AICallResult<T>> {
  const startTime = Date.now();
  const model = params.model || 'claude-sonnet-4-20250514';

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Not authenticated');
  }

  const { data: userData } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single();

  if (!userData?.tenant_id) {
    throw new Error('No tenant found');
  }

  const response = await anthropic.messages.create({
    model,
    max_tokens: params.max_tokens ?? 1000,
    messages: [
      {
        role: 'user',
        content: params.prompt,
      },
    ],
  });

  const aiResponse =
    response.content[0].type === 'text' ? response.content[0].text : '';

  const parsedData = parser(aiResponse);

  const latency = Date.now() - startTime;
  const tokensInput = response.usage.input_tokens;
  const tokensOutput = response.usage.output_tokens;
  const tokensTotal = tokensInput + tokensOutput;

  const costInput = (tokensInput / 1_000_000) * 3.0;
  const costOutput = (tokensOutput / 1_000_000) * 15.0;
  const totalCost = costInput + costOutput;

  const { data: logData, error: logError } = await supabase
    .from('ai_interactions')
    .insert({
      tenant_id: userData.tenant_id,
      interaction_type: params.type,
      input_prompt: params.prompt,
      input_data: params.inputData,
      ai_response: aiResponse,
      parsed_output: parsedData,
      model,
      provider: 'anthropic',
      tokens_input: tokensInput,
      tokens_output: tokensOutput,
      tokens_total: tokensTotal,
      latency_ms: latency,
      cost_usd: totalCost,
      accepted: true,
      job_id: params.jobId ?? null,
      worker_id: params.workerId ?? null,
      quote_id: params.quoteId ?? null,
      import_source_id: params.importSourceId ?? null,
      environment: process.env.NODE_ENV || 'production',
    })
    .select('id')
    .single();

  if (logError) {
    console.error('Failed to log AI interaction:', logError);
  }

  return {
    data: parsedData,
    interactionId: logData?.id ?? '',
    cost: totalCost,
    latency,
  };
}

export async function logUserEdit(
  interactionId: string,
  originalOutput: unknown,
  correctedOutput: unknown
) {
  if (!interactionId) return;
  const supabase = await createClient();

  const original = Array.isArray(originalOutput) ? originalOutput : [];
  const corrected = Array.isArray(correctedOutput) ? correctedOutput : [];

  await supabase
    .from('ai_interactions')
    .update({
      user_edited: true,
      edit_details: {
        original: originalOutput,
        corrected: correctedOutput,
        added: Array.isArray(correctedOutput) && Array.isArray(originalOutput)
          ? correctedOutput.filter((item) => !originalOutput.includes(item))
          : null,
        removed: Array.isArray(correctedOutput) && Array.isArray(originalOutput)
          ? originalOutput.filter((item) => !correctedOutput.includes(item))
          : null,
      },
    })
    .eq('id', interactionId);
}

export async function logActualOutcome(
  interactionId: string,
  actualOutcome: unknown
) {
  if (!interactionId) return;
  const supabase = await createClient();

  await supabase
    .from('ai_interactions')
    .update({
      actual_outcome: actualOutcome,
    })
    .eq('id', interactionId);
}
