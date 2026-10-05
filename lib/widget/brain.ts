import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PriceProfile } from '@/lib/lite/profile-schema';
import { supportsEffort, WIDGET_AI_MODEL } from '@/lib/ai/model';
import { logStructuredAiInteraction } from '@/lib/services/ai-interaction-log';
import {
  allowedAmounts,
  formatPounds,
  guardQuote,
  replyAmountsAllowed,
  replyMentionsAmount,
} from '@/lib/widget/price-guard';
import { buildWidgetSystemPrompt, type PromptBusiness } from '@/lib/widget/prompt';
import { WidgetTurnSchema, type GuardedQuote } from '@/lib/widget/turn-schema';

export type BrainMessage = { role: 'user' | 'assistant'; content: string };

export type BrainResult = {
  reply: string;
  quote: GuardedQuote | null;
  askForDetails: boolean;
  outOfArea: boolean;
  usedFallback: boolean;
};

export const BRAIN_FALLBACK_REPLY = (signOff: string): string =>
  `Sorry, I'm having a bit of trouble — leave your details and ${signOff} will get back to you.`;

const CONFIRM_REPLY = (signOff: string): string =>
  `I'd rather ${signOff} prices that one — send an enquiry and they'll get back to you.`;

function fallback(signOff: string): BrainResult {
  return {
    reply: BRAIN_FALLBACK_REPLY(signOff),
    quote: null,
    askForDetails: true,
    outOfArea: false,
    usedFallback: true,
  };
}

async function safeLog(
  admin: SupabaseClient,
  params: Parameters<typeof logStructuredAiInteraction>[1],
): Promise<void> {
  try {
    await logStructuredAiInteraction(admin, params);
  } catch {
    // A log write must not change what the visitor sees.
  }
}

export async function answerVisitor(
  admin: SupabaseClient,
  p: {
    tenantId: string;
    conversationId: string;
    business: PromptBusiness;
    profile: PriceProfile | null;
    history: BrainMessage[];
    /** Practice chat in the dashboard. Logged so the daily cap can count it, and nothing else is saved. */
    preview?: boolean;
  },
): Promise<BrainResult> {
  const startedAt = Date.now();
  const model = WIDGET_AI_MODEL;
  const system = [
    {
      type: 'text' as const,
      text: buildWidgetSystemPrompt(p.business, p.profile),
      cache_control: { type: 'ephemeral' as const },
    },
  ];
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    maxRetries: 0,
  });

  const log = (result: BrainResult, tokensInput: number, tokensOutput: number) =>
    safeLog(admin, {
      tenantId: p.tenantId,
      interactionType: 'widget_chat',
      prompt: 'widget_chat',
      inputData: {
        conversationId: p.conversationId,
        turns: p.history.length,
        ...(p.preview ? { preview: true } : {}),
      },
      parsedOutput: {
        quote: result.quote,
        askForDetails: result.askForDetails,
        outOfArea: result.outOfArea,
        usedFallback: result.usedFallback,
      },
      model,
      tokensInput,
      tokensOutput,
      latencyMs: Date.now() - startedAt,
    });

  try {
    const response = await anthropic.messages.parse(
      {
        model,
        max_tokens: 2000,
        system,
        messages: p.history,
        output_config: {
          ...(supportsEffort(model) ? { effort: 'medium' as const } : {}),
          format: zodOutputFormat(WidgetTurnSchema),
        },
      },
      { timeout: 25_000 },
    );

    const tokensInput = response.usage?.input_tokens ?? 0;
    const tokensOutput = response.usage?.output_tokens ?? 0;

    if (response.stop_reason === 'refusal' || !response.parsed_output) {
      const result = fallback(p.business.signOff);
      await log(result, tokensInput, tokensOutput);
      return result;
    }

    const parsed = response.parsed_output;
    let quote = guardQuote(parsed.quote, p.profile);
    let reply = parsed.reply;
    let askForDetails = parsed.ask_for_details;
    if (!replyAmountsAllowed(reply, allowedAmounts(p.profile, quote, p.business.businessContext))) {
      reply = CONFIRM_REPLY(p.business.signOff);
      if (quote?.kind === 'firm') quote = null;
      askForDetails = true;
    }
    if (parsed.out_of_area) {
      quote = null;
      askForDetails = false;
    } else if (quote) {
      askForDetails = true;
      if (quote.kind === 'firm' && !replyMentionsAmount(reply, quote.amount)) {
        reply = `${reply.trim()} About £${formatPounds(quote.amount)}. That's an estimate and can change.`;
      }
    }

    const result: BrainResult = {
      reply,
      quote,
      askForDetails,
      outOfArea: parsed.out_of_area,
      usedFallback: false,
    };
    await log(result, tokensInput, tokensOutput);
    return result;
  } catch {
    const result = fallback(p.business.signOff);
    await log(result, 0, 0);
    return result;
  }
}
