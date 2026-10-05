import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { CONVERSATION_SUMMARY_AI_MODEL, supportsEffort } from '@/lib/ai/model';
import { logStructuredAiInteraction } from '@/lib/services/ai-interaction-log';
import type { GuardedQuote } from '@/lib/widget/turn-schema';
import type { StoredMessage } from '@/lib/widget/conversation';

export const CONVERSATION_TAGS = [
  'lead',
  'booking',
  'firm_price',
  'guide_price',
  'visit_offered',
  'out_of_area',
  'question_only',
  'no_details',
  'off_topic',
] as const;

export type ConversationTag = (typeof CONVERSATION_TAGS)[number];

export const SummarySchema = z.object({
  summary: z.string().min(1).max(160),
  tags: z.array(z.enum(['out_of_area', 'question_only', 'off_topic'])).max(3),
});

const AI_TAGS = ['out_of_area', 'question_only', 'off_topic'] as const;

export function ruleTags(p: {
  hasLead: boolean;
  bookingRequested: boolean;
  lastQuote: GuardedQuote | null;
}): ConversationTag[] {
  const tags: ConversationTag[] = [];
  if (p.hasLead) tags.push('lead');
  else tags.push('no_details');
  if (p.hasLead && p.bookingRequested) tags.push('booking');
  if (p.lastQuote?.kind === 'firm') tags.push('firm_price');
  else if (p.lastQuote?.kind === 'guide') tags.push('guide_price');
  else if (p.lastQuote?.kind === 'visit') tags.push('visit_offered');
  return tags;
}

function promptFor(businessName: string): string {
  return `Summarise this website chat for ${businessName} in one plain sentence of at most 160 characters: what the customer wanted, where, and what price or visit was offered. Tag out_of_area if they were outside the area, question_only if they only asked a question, off_topic if it wasn't about the work.`;
}

function transcript(messages: StoredMessage[]): string {
  const lines = messages
    .filter((message) => message.content.trim() !== '')
    .map((message) => `${message.role === 'user' ? 'visitor' : 'assistant'}: ${message.content.trim()}`);
  return lines.length > 0 ? lines.join('\n') : '(no messages)';
}

async function safeLog(
  admin: SupabaseClient,
  params: Parameters<typeof logStructuredAiInteraction>[1],
): Promise<void> {
  try {
    await logStructuredAiInteraction(admin, params);
  } catch {
    // A log write must not decide whether the chat gets a summary.
  }
}

export async function summariseConversation(
  admin: SupabaseClient,
  p: { tenantId: string; conversationId: string; businessName: string; messages: StoredMessage[] },
): Promise<{ summary: string | null; aiTags: ConversationTag[] }> {
  const startedAt = Date.now();
  const model = CONVERSATION_SUMMARY_AI_MODEL;
  const failed = { summary: null, aiTags: [] as ConversationTag[] };

  const log = (parsedOutput: { ok: true; tags: string[] } | { failed: true }, tokensIn: number, tokensOut: number) =>
    safeLog(admin, {
      tenantId: p.tenantId,
      interactionType: 'conversation_summary',
      prompt: 'conversation_summary',
      inputData: { conversationId: p.conversationId },
      parsedOutput,
      model,
      tokensInput: tokensIn,
      tokensOutput: tokensOut,
      latencyMs: Date.now() - startedAt,
    });

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0 });
    const response = await anthropic.messages.parse(
      {
        model,
        max_tokens: 300,
        system: promptFor(p.businessName),
        messages: [{ role: 'user', content: transcript(p.messages) }],
        output_config: {
          ...(supportsEffort(model) ? { effort: 'low' as const } : {}),
          format: zodOutputFormat(SummarySchema),
        },
      },
      { timeout: 15_000 },
    );
    const tokensIn = response.usage?.input_tokens ?? 0;
    const tokensOut = response.usage?.output_tokens ?? 0;
    if (response.stop_reason === 'refusal' || !response.parsed_output) {
      await log({ failed: true }, tokensIn, tokensOut);
      return failed;
    }
    const summary = response.parsed_output.summary.trim().slice(0, 160);
    if (!summary) {
      await log({ failed: true }, tokensIn, tokensOut);
      return failed;
    }
    const aiTags = response.parsed_output.tags.filter((tag): tag is (typeof AI_TAGS)[number] =>
      (AI_TAGS as readonly string[]).includes(tag),
    );
    await log({ ok: true, tags: aiTags }, tokensIn, tokensOut);
    return { summary, aiTags };
  } catch {
    await log({ failed: true }, 0, 0);
    return failed;
  }
}
