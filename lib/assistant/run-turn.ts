import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { ASSISTANT_AI_MODEL, estimateCachedAiCostUsd, supportsEffort } from '@/lib/ai/model';
import { covers, type AssistantCtx } from '@/lib/assistant/caller';
import { buildSystemPrompt, contextLine } from '@/lib/assistant/prompt';
import { anthropicTools, toolsFor, type AnyTool } from '@/lib/assistant/registry';
import {
  ASSISTANT_MONTHLY_QUESTIONS,
  type AssistantCard,
  type PageContext,
  type StreamEvent,
} from '@/lib/assistant/shared';
import {
  appendMessage,
  createConversation,
  getConversation,
  isStale,
  loadMessages,
  questionsThisMonth,
  takeActionNotes,
  touchConversation,
  type ConversationRow,
  type MessageRow,
  type StoredPart,
} from '@/lib/assistant/store';
import type { ToolOutcome } from '@/lib/assistant/tools/types';
import { logStructuredAiInteraction } from '@/lib/services/ai-interaction-log';

const MAX_ROUNDS = 8;
/** Text shorter than this before a tool call is treated as a note to itself and not shown. */
const NOTE_MAX_CHARS = 140;
const MAX_TOKENS = 8000;

type Param = Anthropic.MessageParam;

/**
 * Rebuilds what Claude saw, exactly as saved (append-only: the prompt cache and
 * replayed thinking both need earlier turns unchanged). If a turn died between
 * Claude asking for a tool and the tool's answer being saved, the missing
 * answer is filled in the same way every time, so the history stays valid.
 */
export function toApiMessages(rows: Pick<MessageRow, 'role' | 'content'>[]): Param[] {
  const out: Param[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    out.push({ role: row.role, content: row.content });
    if (row.role !== 'assistant') continue;
    const uses = row.content.filter((b): b is Anthropic.ToolUseBlockParam => b.type === 'tool_use');
    if (uses.length === 0) continue;
    const next = rows[i + 1];
    const answered = next?.role === 'user' && next.content.some((b) => b.type === 'tool_result');
    if (!answered) {
      out.push({
        role: 'user',
        content: uses.map((u) => ({ type: 'tool_result' as const, tool_use_id: u.id, content: 'Interrupted before this ran.', is_error: true })),
      });
    }
  }
  return out;
}

function withCacheBreakpoint(messages: Param[]): Param[] {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1]!;
  const blocks: Anthropic.ContentBlockParam[] =
    typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : [...last.content];
  const tail = blocks[blocks.length - 1];
  if (!tail || tail.type === 'thinking' || tail.type === 'redacted_thinking') return messages;
  blocks[blocks.length - 1] = { ...tail, cache_control: { type: 'ephemeral' } } as Anthropic.ContentBlockParam;
  return [...messages.slice(0, -1), { role: last.role, content: blocks }];
}

function stripThinking(messages: Param[]): Param[] {
  return messages.map((m) =>
    typeof m.content === 'string' || m.role !== 'assistant'
      ? m
      : { ...m, content: m.content.filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking') },
  );
}

function titleFrom(message: string): string {
  const flat = message.replace(/\s+/g, ' ').trim();
  return flat.length <= 60 ? flat : `${flat.slice(0, 57).trimEnd()}…`;
}

async function businessName(ctx: AssistantCtx): Promise<string> {
  const { data } = await ctx.db.from('tenants').select('name').eq('id', ctx.tenantId).maybeSingle();
  const name = (data as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name.trim() !== '' ? name.trim() : 'this business';
}

async function runTool(ctx: AssistantCtx, tool: AnyTool | undefined, block: Anthropic.ToolUseBlock, conversationId: string): Promise<ToolOutcome> {
  if (!tool) return { content: JSON.stringify({ error: `No tool called ${block.name}.` }), isError: true };
  if (!covers(ctx, tool.product)) return { content: JSON.stringify({ error: 'That part of WorkWise is not on their plan any more.' }), isError: true };
  const parsed = tool.schema.safeParse(block.input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { content: JSON.stringify({ error: `Bad input: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`.trim() }), isError: true };
  }
  try {
    const outcome = await tool.run(ctx, parsed.data, { conversationId, toolUseId: block.id });
    return withScreenNote(outcome);
  } catch (err) {
    console.error(`[assistant] tool ${block.name}`, err instanceof Error ? err.message : err);
    return { content: JSON.stringify({ error: 'That lookup failed. Try a different way or tell them it did not work.' }), isError: true };
  }
}

/** One line saying what a card puts on screen, so the words never contradict the picture. */
export function describeCard(card: AssistantCard): string {
  switch (card.type) {
    case 'map':
      return `a map with ${card.stops.length} ${card.date ? 'stops in round order' : 'places'}${card.missing ? ` (${card.missing} could not be placed and are left off)` : ''}${card.approximate ? ` (${card.approximate} placed by postcode area only)` : ''}`;
    case 'list':
      return `a list "${card.title}" showing ${card.items.length} rows${card.footer ? ` (${card.footer})` : ''}${card.total ? `, total ${card.total.value}` : ''}`;
    case 'schedule':
      return `the visits for ${card.days.length} day(s): ${card.days.map((d) => `${d.label} ${d.stops.length} visits ${d.total}`).join('; ')}${card.footer ? ` (${card.footer})` : ''}`;
    case 'bar_chart':
      return `a bar chart "${card.title}" with ${card.points.length} bars (${card.series.map((s) => s.label).join(', ')})`;
    case 'stats':
      return `key figures: ${card.items.map((i) => `${i.label} ${i.value}`).join(', ')}`;
    case 'customer':
      return `${card.name}'s customer card`;
    default:
      return 'a card';
  }
}

/** Tells Claude exactly what its tool put on screen (cards are drawn from the full rows, which can differ from the sample it reads). */
function withScreenNote(outcome: ToolOutcome): ToolOutcome {
  if (!outcome.cards?.length || outcome.isError) return outcome;
  try {
    const data = JSON.parse(outcome.content) as Record<string, unknown>;
    return { ...outcome, content: JSON.stringify({ ...data, on_screen_now: outcome.cards.map(describeCard) }) };
  } catch {
    return outcome;
  }
}

/**
 * One question → Claude's answer, streamed. Read tools run straight away;
 * change tools only save a Do it / Cancel card.
 */
export async function* runTurn(
  ctx: AssistantCtx,
  p: {
    conversationId?: string | null;
    message: string;
    page?: PageContext | null;
    /** For measuring cost (the eval); the app doesn't use it. */
    onUsage?: (u: { uncachedInput: number; cacheWrite: number; cacheRead: number; output: number; costUsd: number; toolCalls: number }) => void;
  },
): AsyncGenerator<StreamEvent> {
  const used = await questionsThisMonth(ctx.admin, ctx.tenantId, ctx.today);
  if (used >= ASSISTANT_MONTHLY_QUESTIONS) {
    yield {
      type: 'error',
      code: 'limit',
      message: "You've used this month's assistant questions. They start again on the 1st — everything else in WorkWise works as normal.",
    };
    return;
  }

  // Carry on the chat they're in, unless it was cleared or they've been away 45 minutes: then start fresh.
  let conversation: ConversationRow | null = p.conversationId
    ? await getConversation(ctx.admin, { id: p.conversationId, userId: ctx.userId, tenantId: ctx.tenantId })
    : null;
  if (conversation && isStale(conversation)) conversation = null;
  const fresh = !conversation;
  if (!conversation) {
    const products = [ctx.hasRounds ? 'rounds' : null, ctx.hasLite ? 'lite' : null, ctx.hasPro ? 'pro' : null].filter((x): x is string => x != null);
    conversation = await createConversation(ctx.admin, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      title: titleFrom(p.message),
      systemPrompt: buildSystemPrompt({ hasRounds: ctx.hasRounds, hasLite: ctx.hasLite, hasPro: ctx.hasPro, surface: ctx.surface }),
      products,
      surface: ctx.surface,
    });
    if (!conversation) {
      yield { type: 'error', code: 'failed', message: "I couldn't start a chat just now. Try again in a minute." };
      return;
    }
  }
  yield { type: 'conversation', id: conversation.id, title: conversation.title, fresh };

  const tools = toolsFor({ rounds: conversation.products.includes('rounds'), lite: conversation.products.includes('lite'), pro: conversation.products.includes('pro') });
  const toolsByName = new Map(tools.map((t) => [t.name, t]));
  const apiTools = anthropicTools(tools);
  // Cached for an hour: the same for every business with these products (the business name is in each question).
  const system: Anthropic.TextBlockParam[] = [{ type: 'text', text: conversation.system_prompt, cache_control: { type: 'ephemeral', ttl: '1h' } }];

  const history = toApiMessages(await loadMessages(ctx.admin, conversation.id));
  const notes = await takeActionNotes(ctx.admin, conversation.id);
  const lead = contextLine(ctx.today, p.page, await businessName(ctx)) + (notes.length > 0 ? `\n[Since your last reply: ${notes.join(' ')}]` : '');
  const question: Anthropic.ContentBlockParam[] = [
    { type: 'text', text: lead },
    { type: 'text', text: p.message },
  ];
  await appendMessage(ctx.admin, {
    conversationId: conversation.id,
    tenantId: ctx.tenantId,
    role: 'user',
    kind: 'question',
    content: question,
    ui: { parts: [{ type: 'text', text: p.message }] },
  });
  history.push({ role: 'user', content: question });

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1 });
  const model = ASSISTANT_AI_MODEL;
  const startedAt = Date.now();
  let tokensInput = 0;
  let tokensOutput = 0;
  const usage = { uncachedInput: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, output: 0 };
  let toolCalls = 0;
  let failed = false;
  let strip = false;
  // Words from a later step start a new paragraph instead of running on ("…11 Oct.You've got").
  let wroteText = false;
  let heldNote: string | null = null;

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      let final: Anthropic.Message;
      try {
        const stream = anthropic.messages.stream(
          {
            model,
            max_tokens: MAX_TOKENS,
            system,
            tools: apiTools,
            messages: withCacheBreakpoint(strip ? stripThinking(history) : history),
            thinking: { type: 'adaptive' },
            ...(supportsEffort(model) ? { output_config: { effort: 'low' as const } } : {}),
          },
          { timeout: 90_000 },
        );
        // A short note before a lookup ("Need recent visits; check each.") is the
        // model talking to itself. Hold the first words of each step back; if the
        // step ends by calling a tool while they're still short, they're dropped.
        // Anything longer streams as normal.
        let breakDue = wroteText;
        let held = '';
        let flowing = false;
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            if (!flowing) {
              held += event.delta.text;
              if (held.length < NOTE_MAX_CHARS) continue;
              flowing = true;
              if (breakDue) {
                breakDue = false;
                yield { type: 'text', delta: '\n\n' };
              }
              wroteText = true;
              yield { type: 'text', delta: held };
              continue;
            }
            yield { type: 'text', delta: event.delta.text };
          }
        }
        heldNote = flowing ? null : held;
        final = await stream.finalMessage();
      } catch (err) {
        // A replayed thinking block the API won't accept: drop them once and try again.
        if (!strip && err instanceof Anthropic.BadRequestError && /thinking/i.test(err.message)) {
          strip = true;
          round--;
          continue;
        }
        throw err;
      }

      tokensInput += (final.usage.input_tokens ?? 0) + (final.usage.cache_read_input_tokens ?? 0) + (final.usage.cache_creation_input_tokens ?? 0);
      tokensOutput += final.usage.output_tokens ?? 0;
      usage.uncachedInput += final.usage.input_tokens ?? 0;
      usage.cacheWrite += final.usage.cache_creation_input_tokens ?? 0;
      usage.cacheWrite1h += final.usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
      usage.cacheRead += final.usage.cache_read_input_tokens ?? 0;
      usage.output += final.usage.output_tokens ?? 0;

      const refused = final.stop_reason === 'refusal';
      const callsTools = final.content.some((b) => b.type === 'tool_use');
      // A short note before a tool call was held back: drop it. A short final answer is shown now.
      const droppedNote = heldNote != null && heldNote.trim() !== '' && callsTools && final.stop_reason !== 'refusal';
      if (heldNote != null && heldNote.trim() !== '' && !droppedNote) {
        if (wroteText) yield { type: 'text', delta: '\n\n' };
        wroteText = true;
        yield { type: 'text', delta: heldNote };
      }
      const texts = droppedNote
        ? []
        : final.content.filter((b): b is Anthropic.TextBlock => b.type === 'text' && b.text.trim() !== '');
      const uiParts: StoredPart[] = texts.map((b) => ({ type: 'text', text: b.text }));
      if (refused) {
        const sorry = "Sorry, I can't help with that one.";
        uiParts.push({ type: 'text', text: sorry });
        yield { type: 'text', delta: sorry };
      }
      await appendMessage(ctx.admin, {
        conversationId: conversation.id,
        tenantId: ctx.tenantId,
        role: 'assistant',
        kind: 'answer',
        content: final.content as unknown as Anthropic.ContentBlockParam[],
        ui: uiParts.length > 0 ? { parts: uiParts } : null,
        tokensInput: final.usage.input_tokens,
        tokensOutput: final.usage.output_tokens,
      });
      history.push({ role: 'assistant', content: final.content });

      const uses = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (uses.length === 0 || refused) break;

      const cutOff = final.stop_reason === 'max_tokens';
      const outcomes: ToolOutcome[] = [];
      if (cutOff) {
        for (let i = 0; i < uses.length; i++) outcomes.push({ content: JSON.stringify({ error: 'Your request was cut off.' }), isError: true });
      } else {
        const labels = [...new Set(uses.map((u) => toolsByName.get(u.name)?.status).filter(Boolean))] as string[];
        for (const label of labels) yield { type: 'status', label };
        toolCalls += uses.length;
        outcomes.push(...(await Promise.all(uses.map((u) => runTool(ctx, toolsByName.get(u.name), u, conversation.id)))));
      }

      const results: Anthropic.ToolResultBlockParam[] = uses.map((u, i) => ({
        type: 'tool_result',
        tool_use_id: u.id,
        content: outcomes[i]!.content,
        ...(outcomes[i]!.isError ? { is_error: true } : {}),
      }));
      const shown: StoredPart[] = [];
      for (const o of outcomes) {
        for (const card of o.cards ?? []) {
          shown.push({ type: 'card', card });
          yield { type: 'card', card };
        }
        if (o.action) {
          shown.push({ type: 'action', id: o.action.id });
          yield { type: 'action', action: o.action };
        }
      }
      await appendMessage(ctx.admin, {
        conversationId: conversation.id,
        tenantId: ctx.tenantId,
        role: 'user',
        kind: 'tool_results',
        content: results,
        ui: shown.length > 0 ? { parts: shown } : null,
      });
      history.push({ role: 'user', content: results });
      if (cutOff) break;
    }
  } catch (err) {
    failed = true;
    console.error('[assistant] turn failed', err instanceof Error ? err.message : err);
    yield { type: 'error', code: 'failed', message: "Sorry, I couldn't finish that. Try asking again in a minute." };
  }

  try {
    await logStructuredAiInteraction(ctx.admin, {
      tenantId: ctx.tenantId,
      interactionType: 'assistant_chat',
      prompt: 'assistant_chat',
      inputData: { conversationId: conversation.id, surface: ctx.surface, toolCalls, ...usage },
      parsedOutput: { failed },
      model,
      tokensInput,
      tokensOutput,
      latencyMs: Date.now() - startedAt,
      costUsd: estimateCachedAiCostUsd(model, usage),
    });
    p.onUsage?.({ ...usage, costUsd: estimateCachedAiCostUsd(model, usage), toolCalls });
  } catch {
    // Logging must never change the answer.
  }
  await touchConversation(ctx.admin, conversation.id);
  if (!failed) yield { type: 'done', questionsLeft: Math.max(0, ASSISTANT_MONTHLY_QUESTIONS - used - 1) };
}


