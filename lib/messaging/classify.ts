import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { DEFAULT_AI_MODEL } from '@/lib/ai/model';
import { formatVisitDay } from '@/lib/payments/messages';
import { addDays, isValidYmd } from '@/lib/rounds/dates';
import { logStructuredAiInteraction } from '@/lib/services/ai-interaction-log';

export const ReplyClassificationSchema = z.object({
  intent: z.enum(['said_no', 'asked_move', 'question', 'other']),
  proposed_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  confidence: z.number().min(0).max(1),
});

export type ReplyIntent = 'said_no' | 'asked_move' | 'question' | 'other';

export type ReplyClassification = {
  intent: ReplyIntent;
  proposedDate: string | null;
  confidence: number;
  source: 'keyword' | 'ai' | 'fallback';
};

export const CLASSIFY_MIN_CONFIDENCE = 0.6;
export const CLASSIFY_MAX_BODY = 500;

const CLASSIFY_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_DAYS_AHEAD = 120;

const FALLBACK: ReplyClassification = {
  intent: 'question',
  proposedDate: null,
  confidence: 0,
  source: 'fallback',
};

function dateLabel(ymd: string): string {
  return `${formatVisitDay(ymd)} ${ymd.slice(0, 4)}`;
}

export function buildClassifyPrompt(p: {
  body: string;
  today: string;
  todayLabel: string;
  visitDate: string | null;
  visitLabel: string | null;
  businessName: string;
}): string {
  const visitSentence = p.visitDate
    ? `The visit this reply is probably about is on ${p.visitLabel} (${p.visitDate}).`
    : 'We do not know which visit this is about.';
  const reply = p.body.slice(0, CLASSIFY_MAX_BODY);
  return `You sort text-message replies sent to ${p.businessName}, a local tradesperson, about a planned visit.
Today is ${p.todayLabel} (${p.today}). ${visitSentence}

Reply: """${reply}"""

Choose one intent:
- said_no: they do not want this visit (e.g. "no", "not this time", "we're away", "cancel", "skip us").
- asked_move: they want the visit on a different day or time.
- question: anything that needs the tradesperson to answer or do something (a question, a request, a complaint, extra work).
- other: needs nothing (e.g. "ok", "thanks", "see you then", an emoji).

proposed_date: only if they clearly name a day for asked_move. Resolve words like "Friday" or "next Tuesday" to the next such date after today, as YYYY-MM-DD. Never guess. Otherwise null.
confidence: 0 to 1, how sure you are of the intent.`;
}

/** Pure: applies the threshold and date rules to the model's raw output. */
export function normaliseClassification(
  raw: z.infer<typeof ReplyClassificationSchema>,
  p: { today: string; maxDaysAhead?: number },
): ReplyClassification {
  const maxDaysAhead = p.maxDaysAhead ?? DEFAULT_MAX_DAYS_AHEAD;
  let intent: ReplyIntent = raw.intent;
  if (
    (intent === 'said_no' || intent === 'asked_move') &&
    raw.confidence < CLASSIFY_MIN_CONFIDENCE
  ) {
    intent = 'question';
  }

  let proposedDate: string | null = null;
  if (intent === 'asked_move' && raw.proposed_date && isValidYmd(raw.proposed_date) && isValidYmd(p.today)) {
    const latest = addDays(p.today, maxDaysAhead);
    if (raw.proposed_date >= p.today && raw.proposed_date <= latest) {
      proposedDate = raw.proposed_date;
    }
  }

  return {
    intent,
    proposedDate,
    confidence: raw.confidence,
    source: 'ai',
  };
}

async function safeLog(
  admin: SupabaseClient,
  params: Parameters<typeof logStructuredAiInteraction>[1],
): Promise<void> {
  try {
    await logStructuredAiInteraction(admin, params);
  } catch {
    // A log write must not change what we tell the trader.
  }
}

export async function classifyReply(
  admin: SupabaseClient,
  p: {
    tenantId: string;
    messageId: string;
    body: string;
    today: string;
    visitDate: string | null;
    businessName: string;
  },
  deps?: { anthropic?: Pick<Anthropic, 'messages'> },
): Promise<ReplyClassification> {
  const visitDate = p.visitDate && isValidYmd(p.visitDate) ? p.visitDate : null;
  const prompt = buildClassifyPrompt({
    body: p.body,
    today: p.today,
    todayLabel: isValidYmd(p.today) ? dateLabel(p.today) : p.today,
    visitDate,
    visitLabel: visitDate ? dateLabel(visitDate) : null,
    businessName: p.businessName,
  });

  const anthropic = deps?.anthropic ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      anthropic.messages.parse(
        {
          model: DEFAULT_AI_MODEL,
          max_tokens: 200,
          messages: [{ role: 'user', content: prompt }],
          // Haiku rejects `effort` (see supportsEffort). Do not send it.
          output_config: { format: zodOutputFormat(ReplyClassificationSchema) },
        },
        { timeout: CLASSIFY_TIMEOUT_MS },
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('classify timeout')), CLASSIFY_TIMEOUT_MS);
      }),
    ]);

    await safeLog(admin, {
      tenantId: p.tenantId,
      interactionType: 'message_classification',
      prompt,
      inputData: { message_id: p.messageId, has_visit: Boolean(p.visitDate) },
      parsedOutput: response.parsed_output,
      model: DEFAULT_AI_MODEL,
      tokensInput: response.usage?.input_tokens ?? 0,
      tokensOutput: response.usage?.output_tokens ?? 0,
      latencyMs: Date.now() - startedAt,
    });

    if (!response.parsed_output) return FALLBACK;
    return normaliseClassification(response.parsed_output, { today: p.today });
  } catch {
    return FALLBACK;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── Replies to money texts (visit done + pay link, chaser, payment thanks) ──

export const PaymentReplySchema = z.object({
  intent: z.enum(['says_paid', 'payment_question', 'other']),
  confidence: z.number().min(0).max(1),
});

export type PaymentReplyIntent = 'says_paid' | 'payment_question' | 'other';

export type PaymentReplyClassification = {
  intent: PaymentReplyIntent;
  confidence: number;
  source: 'ai' | 'fallback';
};

/** A reply we could not sort still reaches the trader. */
const PAYMENT_FALLBACK: PaymentReplyClassification = {
  intent: 'payment_question',
  confidence: 0,
  source: 'fallback',
};

export function buildPaymentReplyPrompt(p: { body: string; businessName: string }): string {
  const reply = p.body.slice(0, CLASSIFY_MAX_BODY);
  return `You sort text-message replies sent to ${p.businessName}, a local tradesperson. The last text the customer got was about money: a bill with a pay link, a friendly payment reminder, or a thank-you for a payment.

Reply: """${reply}"""

Choose one intent:
- says_paid: they say they have already paid (e.g. "paid", "sent it yesterday", "I paid your lad cash", "transferred it this morning").
- payment_question: anything the tradesperson needs to deal with about money: a question, a wrong amount, a complaint, asking for bank details, or a promise to pay later ("I'll pay Friday").
- other: needs nothing (e.g. "ok", "thanks", "great", an emoji).

This is never about moving or cancelling a visit. confidence: 0 to 1, how sure you are.`;
}

/** Pure: a low-confidence "says paid" is treated as a question, so it still reaches the trader. */
export function normalisePaymentReply(
  raw: z.infer<typeof PaymentReplySchema>,
): PaymentReplyClassification {
  let intent: PaymentReplyIntent = raw.intent;
  if (intent === 'says_paid' && raw.confidence < CLASSIFY_MIN_CONFIDENCE) intent = 'payment_question';
  return { intent, confidence: raw.confidence, source: 'ai' };
}

export async function classifyPaymentReply(
  admin: SupabaseClient,
  p: { tenantId: string; messageId: string; body: string; businessName: string },
  deps?: { anthropic?: Pick<Anthropic, 'messages'> },
): Promise<PaymentReplyClassification> {
  const prompt = buildPaymentReplyPrompt({ body: p.body, businessName: p.businessName });
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const anthropic = deps?.anthropic ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await Promise.race([
      anthropic.messages.parse(
        {
          model: DEFAULT_AI_MODEL,
          max_tokens: 150,
          messages: [{ role: 'user', content: prompt }],
          output_config: { format: zodOutputFormat(PaymentReplySchema) },
        },
        { timeout: CLASSIFY_TIMEOUT_MS },
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('classify timeout')), CLASSIFY_TIMEOUT_MS);
      }),
    ]);

    await safeLog(admin, {
      tenantId: p.tenantId,
      interactionType: 'message_classification',
      prompt,
      inputData: { message_id: p.messageId, about: 'payment' },
      parsedOutput: response.parsed_output,
      model: DEFAULT_AI_MODEL,
      tokensInput: response.usage?.input_tokens ?? 0,
      tokensOutput: response.usage?.output_tokens ?? 0,
      latencyMs: Date.now() - startedAt,
    });

    if (!response.parsed_output) return PAYMENT_FALLBACK;
    return normalisePaymentReply(response.parsed_output);
  } catch {
    return PAYMENT_FALLBACK;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
