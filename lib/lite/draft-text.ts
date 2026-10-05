import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { LITE_TEXT_AI_MODEL, supportsEffort } from '@/lib/ai/model';
import { fallbackText, validateDraft, type TextContext, type TextKind } from '@/lib/lite/text-templates';
import { logStructuredAiInteraction } from '@/lib/services/ai-interaction-log';

const DraftSchema = z.object({ text: z.string() });

function money(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2);
}

function jobPhrase(summary: string | null): string {
  const trimmed = summary?.trim() ?? '';
  if (!trimmed) return 'your job';
  const chars = [...trimmed];
  chars[0] = chars[0]?.toLowerCase() ?? '';
  return chars.join('');
}

function purpose(kind: Exclude<TextKind, 'owner_alert'>, c: TextContext, job: string): string {
  if (kind === 'follow_up') {
    return `Thank them for getting in touch about ${job}. Say you'll message them to confirm an exact price. Never say the job is booked or that a price or day is locked in.`;
  }
  if (kind === 'booking_declined') {
    return `Kindly say ${c.sign_off} can't take on ${job} at the moment.`;
  }
  const amount =
    c.quote_kind === 'firm' && typeof c.allowed_amounts[0] === 'number'
      ? ` for £${money(c.allowed_amounts[0])}`
      : '';
  const changed = c.price_changed ? ' \u2014 say the price changed after another look' : '';
  const visit =
    c.quote_kind === 'guide' || c.quote_kind === 'visit' ? " \u2014 it's a free look-and-quote visit" : '';
  return `Tell them ${c.sign_off} is happy to do ${job}${amount}${changed}${visit}.`;
}

function systemPrompt(kind: Exclude<TextKind, 'owner_alert'>, c: TextContext): string {
  const job = jobPhrase(c.job_summary);
  const mobile = c.owner_mobile_display ? `, ${c.owner_mobile_display}` : '';
  const prices =
    c.allowed_amounts.length > 0
      ? c.allowed_amounts.map((amount) => `£${money(amount)}`).join(', ')
      : 'none \u2014 do not mention any price';
  return `Write one text message from ${c.sign_off} at ${c.business_name} (${c.trade}) to a customer called ${c.first_name}. It must read like ${c.sign_off} typed it on their own phone: warm, short, plain British English, no emojis, no links, nothing that sounds automated. ${purpose(kind, c, job)} Say ${c.sign_off} will message them from their own mobile${mobile}. The only prices you may mention: ${prices}. Never promise a date or a time. At most 280 characters. End with '${c.sign_off}'.`;
}

function modelContext(c: TextContext): Record<string, unknown> {
  return {
    first_name: c.first_name,
    business_name: c.business_name,
    sign_off: c.sign_off,
    trade: c.trade,
    owner_mobile_display: c.owner_mobile_display,
    job_summary: c.job_summary,
    quote_kind: c.quote_kind,
    allowed_amounts: c.allowed_amounts,
    booking_requested: c.booking_requested,
    price_changed: c.price_changed,
    preferred_days: c.preferred_days,
  };
}

async function safeLog(
  admin: SupabaseClient,
  params: Parameters<typeof logStructuredAiInteraction>[1],
): Promise<void> {
  try {
    await logStructuredAiInteraction(admin, params);
  } catch {
    // A log write must not change which text goes out.
  }
}

export async function draftLeadText(
  admin: SupabaseClient,
  p: {
    tenantId: string;
    textId: string;
    kind: Exclude<TextKind, 'owner_alert'>;
    context: TextContext;
  },
): Promise<{ body: string; draftedBy: 'ai' | 'template' }> {
  const startedAt = Date.now();
  const model = LITE_TEXT_AI_MODEL;
  const fallback = () => ({ body: fallbackText(p.kind, p.context), draftedBy: 'template' as const });

  const log = (parsedOutput: { draftedBy: 'ai' } | { failed: true; reason: string }, tokensIn: number, tokensOut: number) =>
    safeLog(admin, {
      tenantId: p.tenantId,
      interactionType: 'lite_text_draft',
      prompt: 'lite_text_draft',
      inputData: { textId: p.textId, kind: p.kind },
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
        max_tokens: 400,
        system: systemPrompt(p.kind, p.context),
        messages: [{ role: 'user', content: JSON.stringify(modelContext(p.context)) }],
        output_config: {
          ...(supportsEffort(model) ? { effort: 'low' as const } : {}),
          format: zodOutputFormat(DraftSchema),
        },
      },
      { timeout: 15_000 },
    );
    const tokensIn = response.usage?.input_tokens ?? 0;
    const tokensOut = response.usage?.output_tokens ?? 0;
    if (response.stop_reason === 'refusal' || !response.parsed_output) {
      await log({ failed: true, reason: 'ai' }, tokensIn, tokensOut);
      return fallback();
    }
    const draft = validateDraft(response.parsed_output.text, p.context);
    if (!draft.ok) {
      await log({ failed: true, reason: draft.reason }, tokensIn, tokensOut);
      return fallback();
    }
    await log({ draftedBy: 'ai' }, tokensIn, tokensOut);
    return { body: draft.text, draftedBy: 'ai' };
  } catch {
    await log({ failed: true, reason: 'ai' }, 0, 0);
    return fallback();
  }
}
