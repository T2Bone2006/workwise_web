import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ZodType } from 'zod';
import { INTERVIEW_AI_MODEL, supportsEffort } from '@/lib/ai/model';
import {
  EXAMPLES_INTRO,
  ExampleAnswerSchema,
  ExampleDetailSchema,
  ExampleSuggestionsSchema,
  InterviewTurnSchema,
  MOBILE_QUESTION,
  WEBSITE_QUESTION,
  exampleQuestion,
  interviewMessageError,
  mergePatch,
  missingForFinish,
  nextChatStage,
  readSetupChat,
  signOffQuestion,
  stageReady,
  type DraftProfile,
  type SetupChat,
  type Stage,
} from '@/lib/lite/interview-schema';
import {
  buildExampleAnswerPrompt,
  buildExampleDetailPrompt,
  buildExampleSystemPrompt,
  buildInterviewSystemPrompt,
  interviewNotesBlock,
  openingLine,
  type InterviewBusiness,
} from '@/lib/lite/interview-prompt';
import type { LiteContext } from '@/lib/lite/require-lite';
import { PriceProfileSchema, parseProfile, type PriceProfile } from '@/lib/lite/profile-schema';
import { normaliseWebsite } from '@/lib/widget/origin';
import { logStructuredAiInteraction } from '@/lib/services/ai-interaction-log';
import { normalizeUkPhoneE164 } from '@/lib/utils/phone';

const AI_FAILED_REPLY = "Sorry, I lost my train of thought — could you say that again?";
const WEBSITE_ERROR = "That doesn't look like a website address — try something like daveplastering.co.uk";
const TURN_CAP = 100;
const MOBILE_RE = /^\+447\d{9}$/;

export type ExampleJob = { description: string; price: number; reasoning: string };

export type InterviewView = {
  id: string;
  stage: Stage;
  messages: { role: 'user' | 'assistant'; content: string }[];
  draft: DraftProfile;
  examples: ExampleJob[];
  status: 'in_progress' | 'finished';
};

type InterviewMessage = InterviewView['messages'][number];

type TurnResult =
  | { ok: true; view: InterviewView }
  | { ok: false; error: 'ai_failed'; view: InterviewView }
  | { ok: false; error: 'not_found' | 'finished' | 'too_long' | 'busy' };

type Row = Record<string, unknown>;

function asStage(value: unknown): Stage {
  if (
    value === 'areas' ||
    value === 'work' ||
    value === 'pricing' ||
    value === 'rules' ||
    value === 'examples' ||
    value === 'website' ||
    value === 'done'
  ) {
    return value;
  }
  return 'areas';
}

function asMessages(raw: unknown): InterviewMessage[] {
  if (!Array.isArray(raw)) return [];
  const messages: InterviewMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Row;
    if ((row.role !== 'user' && row.role !== 'assistant') || typeof row.content !== 'string') continue;
    messages.push({ role: row.role, content: row.content });
  }
  return messages;
}

function asDraft(raw: unknown): DraftProfile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as DraftProfile;
}

function asExamples(raw: unknown): ExampleJob[] {
  if (!Array.isArray(raw)) return [];
  const examples: ExampleJob[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Row;
    if (typeof row.description !== 'string' || typeof row.reasoning !== 'string') continue;
    if (typeof row.price !== 'number' || !Number.isFinite(row.price)) continue;
    examples.push({ description: row.description, price: row.price, reasoning: row.reasoning });
  }
  return examples;
}

function viewFrom(row: Row): InterviewView {
  const draft = asDraft(row.draft_profile);
  const column = asExamples(row.example_jobs);
  const examples = column.length > 0 ? column : asExamples(draft.example_jobs);
  const status = row.status === 'finished' ? 'finished' : 'in_progress';
  return {
    id: String(row.id),
    stage: asStage(row.stage),
    messages: asMessages(row.messages),
    draft: { ...draft, example_jobs: examples },
    examples,
    status,
  };
}

async function safeLog(
  admin: SupabaseClient,
  params: Parameters<typeof logStructuredAiInteraction>[1],
): Promise<void> {
  try {
    await logStructuredAiInteraction(admin, params);
  } catch {
    // A log write must not change what the tradie sees.
  }
}

async function firstName(admin: SupabaseClient, ctx: LiteContext): Promise<string> {
  try {
    const { data } = await admin.from('users').select('full_name').eq('id', ctx.userId).maybeSingle();
    const name = (data as Row | null)?.full_name;
    const full = typeof name === 'string' ? name.trim() : '';
    const word = full.split(/\s+/)[0] ?? '';
    if (word) return word.slice(0, 40);
  } catch {
    // Fall through to a greeting that still reads properly.
  }
  return 'there';
}

async function loadOpen(admin: SupabaseClient, tenantId: string): Promise<Row | null> {
  const { data, error } = await admin
    .from('lite_interviews')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('status', 'in_progress')
    .maybeSingle();
  if (error || !data) return null;
  return data as Row;
}

async function loadById(admin: SupabaseClient, tenantId: string, interviewId: string): Promise<Row | null> {
  const { data, error } = await admin
    .from('lite_interviews')
    .select('*')
    .eq('id', interviewId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error || !data) return null;
  return data as Row;
}

async function loadLiveProfile(admin: SupabaseClient, tenantId: string): Promise<PriceProfile | null> {
  const { data, error } = await admin
    .from('lite_price_profiles')
    .select('profile, version')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error || !data) return null;
  const parsed = PriceProfileSchema.safeParse((data as Row).profile);
  return parsed.success ? parsed.data : null;
}

function businessOf(ctx: LiteContext): InterviewBusiness {
  return { businessName: ctx.widget.business_name, trade: ctx.widget.trade };
}

async function askModel<T>(
  admin: SupabaseClient,
  p: {
    tenantId: string;
    interviewId: string;
    stage: Stage;
    schema: ZodType<T>;
    system: { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }[];
    messages: { role: 'user' | 'assistant'; content: string }[];
  },
): Promise<{ ok: true; value: T; tokensIn: number; tokensOut: number; latencyMs: number } | { ok: false }> {
  const startedAt = Date.now();
  const model = INTERVIEW_AI_MODEL;
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0 });
    const response = await anthropic.messages.parse(
      {
        model,
        max_tokens: 4000,
        system: p.system,
        messages: p.messages,
        output_config: {
          ...(supportsEffort(model) ? { effort: 'medium' as const } : {}),
          format: zodOutputFormat(p.schema),
        },
      },
      { timeout: 45_000 },
    );
    const tokensIn = response.usage?.input_tokens ?? 0;
    const tokensOut = response.usage?.output_tokens ?? 0;
    const latencyMs = Date.now() - startedAt;
    if (response.stop_reason === 'refusal' || !response.parsed_output) {
      await safeLog(admin, {
        tenantId: p.tenantId,
        interactionType: 'lite_interview',
        prompt: 'lite_interview',
        inputData: { interviewId: p.interviewId, stage: p.stage },
        parsedOutput: { failed: true },
        model,
        tokensInput: tokensIn,
        tokensOutput: tokensOut,
        latencyMs,
      });
      return { ok: false };
    }
    return { ok: true, value: response.parsed_output as T, tokensIn, tokensOut, latencyMs };
  } catch {
    await safeLog(admin, {
      tenantId: p.tenantId,
      interactionType: 'lite_interview',
      prompt: 'lite_interview',
      inputData: { interviewId: p.interviewId, stage: p.stage },
      parsedOutput: { failed: true },
      model,
      tokensInput: 0,
      tokensOutput: 0,
      latencyMs: Date.now() - startedAt,
    });
    return { ok: false };
  }
}

export async function getOrStartInterview(
  admin: SupabaseClient,
  ctx: LiteContext,
  opts?: { redo?: boolean },
): Promise<InterviewView> {
  const open = await loadOpen(admin, ctx.tenantId);
  if (open) return viewFrom(open);

  const live = opts?.redo ? await loadLiveProfile(admin, ctx.tenantId) : null;
  const draft: DraftProfile = live ? { ...live } : {};
  const examples = live?.example_jobs ?? [];
  const name = await firstName(admin, ctx);
  const row = {
    tenant_id: ctx.tenantId,
    status: 'in_progress',
    stage: 'areas',
    messages: [{ role: 'assistant', content: openingLine(name) }],
    draft_profile: { ...draft, example_jobs: examples },
    example_jobs: examples,
    turn_count: 0,
    started_by_user_id: ctx.userId,
  };
  const { data, error } = await admin.from('lite_interviews').insert(row).select('*').maybeSingle();
  if (!error && data) return viewFrom(data as Row);
  const code = (error as { code?: string } | null)?.code;
  if (code === '23505') {
    const again = await loadOpen(admin, ctx.tenantId);
    if (again) return viewFrom(again);
  }
  throw new Error('Could not start the interview');
}

export async function interviewTurn(
  admin: SupabaseClient,
  ctx: LiteContext,
  p: { interviewId: string; message: string },
): Promise<TurnResult> {
  if (interviewMessageError(p.message)) return { ok: false, error: 'too_long' };

  const row = await loadById(admin, ctx.tenantId, p.interviewId);
  if (!row) return { ok: false, error: 'not_found' };
  if (row.status === 'finished') return { ok: false, error: 'finished' };
  if (row.status !== 'in_progress') return { ok: false, error: 'not_found' };

  const turnCount = typeof row.turn_count === 'number' ? row.turn_count : 0;
  if (turnCount >= TURN_CAP) return { ok: false, error: 'too_long' };

  const text = p.message.trim();
  const stage = asStage(row.stage);
  if (stage === 'examples' || stage === 'website') {
    return answerGuidedChat(admin, ctx, row, text, turnCount);
  }
  const prior = asMessages(row.messages);
  const withUser = [...prior, { role: 'user' as const, content: text }];
  const { data: claimed, error: claimError } = await admin
    .from('lite_interviews')
    .update({ messages: withUser, turn_count: turnCount + 1 })
    .eq('id', p.interviewId)
    .eq('tenant_id', ctx.tenantId)
    .eq('status', 'in_progress')
    .eq('turn_count', turnCount)
    .select('id');
  if (claimError || !claimed || claimed.length === 0) return { ok: false, error: 'busy' };

  const draft = viewFrom(row).draft;
  const model = await askModel(admin, {
    tenantId: ctx.tenantId,
    interviewId: p.interviewId,
    stage,
    schema: InterviewTurnSchema,
    system: [
      {
        type: 'text',
        text: buildInterviewSystemPrompt(businessOf(ctx)),
        cache_control: { type: 'ephemeral' },
      },
      { type: 'text', text: interviewNotesBlock(stage, draft) },
    ],
    messages: [{ role: 'user', content: 'Start the interview.' }, ...withUser],
  });

  if (!model.ok) {
    const failedMessages = [...withUser, { role: 'assistant' as const, content: AI_FAILED_REPLY }];
    await admin
      .from('lite_interviews')
      .update({ messages: failedMessages })
      .eq('id', p.interviewId)
      .eq('tenant_id', ctx.tenantId)
      .eq('turn_count', turnCount + 1);
    return {
      ok: false,
      error: 'ai_failed',
      view: { ...viewFrom({ ...row, messages: failedMessages, turn_count: turnCount + 1 }), messages: failedMessages },
    };
  }

  const parsed = model.value;
  const merged = mergePatch(draft, parsed.patch);
  const advance = parsed.stage_complete && stageReady(stage, merged) ? nextChatStage(stage) : null;
  const nextStage = advance ?? stage;
  const messages = [...withUser, { role: 'assistant' as const, content: parsed.reply }];
  const savedDraft = { ...merged, example_jobs: draft.example_jobs ?? merged.example_jobs ?? [] };
  await admin
    .from('lite_interviews')
    .update({
      messages,
      draft_profile: savedDraft,
      stage: nextStage,
    })
    .eq('id', p.interviewId)
    .eq('tenant_id', ctx.tenantId)
    .eq('turn_count', turnCount + 1);

  await safeLog(admin, {
    tenantId: ctx.tenantId,
    interactionType: 'lite_interview',
    prompt: 'lite_interview',
    inputData: { interviewId: p.interviewId, stage },
    parsedOutput: { stageComplete: parsed.stage_complete, stage: nextStage },
    model: INTERVIEW_AI_MODEL,
    tokensInput: model.tokensIn,
    tokensOutput: model.tokensOut,
    latencyMs: model.latencyMs,
  });

  return {
    ok: true,
    view: viewFrom({
      ...row,
      stage: nextStage,
      messages,
      draft_profile: savedDraft,
      turn_count: turnCount + 1,
      status: 'in_progress',
    }),
  };
}

function withChat(draft: DraftProfile, chat: SetupChat, examples?: ExampleJob[]): DraftProfile {
  return { ...draft, ...(examples ? { example_jobs: examples } : {}), setup_chat: chat } as DraftProfile;
}

function pounds(price: number): string {
  return Number.isInteger(price) ? `£${price}` : `£${price.toFixed(2)}`;
}

function websiteFromMessage(text: string): string | null {
  const direct = normaliseWebsite(text);
  if (direct) return direct;
  const found = text.match(/\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/i);
  return found ? normaliseWebsite(found[1]) : null;
}

function signOffFrom(text: string, suggested: string): string | null {
  const trimmed = text.trim().replace(/^["']|["']$/g, '');
  if (/^(yes|yeah|yep|ok|okay|fine|that's fine|that one)$/i.test(trimmed) && suggested) return suggested;
  if (trimmed.length < 1 || trimmed.length > 40) return null;
  return trimmed;
}

function mobileFrom(text: string): { ok: true; mobile: string | null } | { ok: false } {
  if (/^(skip|no|none|no thanks|rather not|leave it out|leave it)\b/i.test(text.trim())) return { ok: true, mobile: null };
  const e164 = normalizeUkPhoneE164(text);
  if (!e164 || !MOBILE_RE.test(e164)) return { ok: false };
  return { ok: true, mobile: e164 };
}

async function suggestedSignOff(admin: SupabaseClient, ctx: LiteContext): Promise<string> {
  const saved = ctx.widget.sign_off_name?.trim() ?? '';
  if (saved) return saved.slice(0, 40);
  const name = await firstName(admin, ctx);
  return name === 'there' ? '' : name;
}

async function claimTurn(
  admin: SupabaseClient,
  ctx: LiteContext,
  interviewId: string,
  turnCount: number,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await admin
    .from('lite_interviews')
    .update(patch)
    .eq('id', interviewId)
    .eq('tenant_id', ctx.tenantId)
    .eq('status', 'in_progress')
    .eq('turn_count', turnCount)
    .select('id');
  return !error && Array.isArray(data) && data.length > 0;
}

function guidedView(row: Row, patch: { stage?: Stage; messages?: InterviewMessage[]; draft_profile?: DraftProfile; example_jobs?: ExampleJob[]; turn_count?: number; status?: string }): InterviewView {
  return viewFrom({ ...row, ...patch, status: patch.status ?? row.status ?? 'in_progress' });
}

async function waitForGuided(admin: SupabaseClient, tenantId: string, interviewId: string): Promise<InterviewView | null> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const row = await loadById(admin, tenantId, interviewId);
    if (!row) return null;
    const chat = readSetupChat(asDraft(row.draft_profile));
    if (!chat) return null;
    if (chat.mode !== 'examples' || (chat.cursor >= 0 && chat.prompts.length >= 3)) return viewFrom(row);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return null;
}

export async function beginExampleChat(
  admin: SupabaseClient,
  ctx: LiteContext,
  interviewId: string,
): Promise<{ ok: true; view: InterviewView } | { ok: false; error: string }> {
  const row = await loadById(admin, ctx.tenantId, interviewId);
  if (!row || row.status !== 'in_progress') return { ok: false, error: 'That interview could not be found.' };
  const stage = asStage(row.stage);
  if (stage !== 'examples') return { ok: true, view: viewFrom(row) };

  const draft = asDraft(row.draft_profile);
  const existing = readSetupChat(draft);
  if (existing?.cursor === -1) {
    const waited = await waitForGuided(admin, ctx.tenantId, interviewId);
    if (waited) return { ok: true, view: waited };
    return { ok: false, error: "I couldn't think of examples just then — try again." };
  }
  if (existing && (existing.mode !== 'examples' || existing.prompts.length >= 3)) {
    return { ok: true, view: viewFrom(row) };
  }

  const saved = asExamples(row.example_jobs);
  const turnCount = typeof row.turn_count === 'number' ? row.turn_count : 0;
  const prior = asMessages(row.messages);

  if (saved.length >= 3) {
    const messages = [...prior, { role: 'assistant' as const, content: WEBSITE_QUESTION }];
    const nextDraft = withChat(draft, { mode: 'website', prompts: [], cursor: 0 }, saved);
    const claimed = await claimTurn(admin, ctx, interviewId, turnCount, {
      messages,
      draft_profile: nextDraft,
      stage: 'website',
      turn_count: turnCount + 1,
    });
    if (!claimed) {
      const again = await loadById(admin, ctx.tenantId, interviewId);
      if (again) return { ok: true, view: viewFrom(again) };
      return { ok: false, error: "Couldn't save that. Try again." };
    }
    return { ok: true, view: guidedView(row, { stage: 'website', messages, draft_profile: nextDraft, example_jobs: saved, turn_count: turnCount + 1 }) };
  }

  const locked = await claimTurn(admin, ctx, interviewId, turnCount, {
    draft_profile: withChat(draft, { mode: 'examples', prompts: [], cursor: -1 }),
    turn_count: turnCount + 1,
  });
  if (!locked) {
    const waited = await waitForGuided(admin, ctx.tenantId, interviewId);
    if (waited) return { ok: true, view: waited };
    return { ok: false, error: "I couldn't think of examples just then — try again." };
  }

  const suggested = await suggestExampleJobs(admin, ctx, interviewId);
  if (!suggested.ok) {
    const rolled = { ...draft };
    delete (rolled as { setup_chat?: unknown }).setup_chat;
    await admin
      .from('lite_interviews')
      .update({ draft_profile: rolled })
      .eq('id', interviewId)
      .eq('tenant_id', ctx.tenantId)
      .eq('turn_count', turnCount + 1);
    return suggested;
  }

  const drafted = suggested.examples.map((example) => example.description);
  const rewritten = await rewriteExampleDescriptions(admin, ctx, interviewId, drafted);
  const prompts = rewritten ?? drafted;
  const messages = [
    ...prior,
    { role: 'assistant' as const, content: EXAMPLES_INTRO },
    { role: 'assistant' as const, content: exampleQuestion(prompts[0] ?? '', 0) },
  ];
  const nextDraft = withChat(
    draft,
    { mode: 'examples', prompts, cursor: 0, ...(rewritten ? { detail_version: 2 } : {}) },
    saved,
  );
  await admin
    .from('lite_interviews')
    .update({ messages, draft_profile: nextDraft, stage: 'examples' })
    .eq('id', interviewId)
    .eq('tenant_id', ctx.tenantId)
    .eq('turn_count', turnCount + 1);
  return {
    ok: true,
    view: guidedView(row, { stage: 'examples', messages, draft_profile: nextDraft, example_jobs: saved, turn_count: turnCount + 1 }),
  };
}

async function answerGuidedChat(
  admin: SupabaseClient,
  ctx: LiteContext,
  row: Row,
  text: string,
  turnCount: number,
): Promise<TurnResult> {
  const draft = asDraft(row.draft_profile);
  const chat = readSetupChat(draft);
  if (!chat || chat.cursor < 0) return { ok: false, error: 'busy' };

  const prior = asMessages(row.messages);
  const withUser = [...prior, { role: 'user' as const, content: text }];
  const claimed = await claimTurn(admin, ctx, row.id as string, turnCount, {
    messages: withUser,
    turn_count: turnCount + 1,
  });
  if (!claimed) return { ok: false, error: 'busy' };

  const saved = asExamples(row.example_jobs);
  const reply = await guidedReply(admin, ctx, chat, text, saved, String(row.id), withUser);
  const messages = [...withUser, { role: 'assistant' as const, content: reply.content }];
  const examples = reply.examples ?? saved;
  const nextDraft = withChat({ ...draft, example_jobs: examples }, reply.chat, examples);
  await admin
    .from('lite_interviews')
    .update({
      messages,
      draft_profile: nextDraft,
      example_jobs: examples,
      stage: reply.stage,
      ...(reply.status ? { status: reply.status, finished_at: new Date().toISOString() } : {}),
    })
    .eq('id', row.id as string)
    .eq('tenant_id', ctx.tenantId)
    .eq('turn_count', turnCount + 1);

  return {
    ok: true,
    view: guidedView(row, {
      stage: reply.stage,
      messages,
      draft_profile: nextDraft,
      example_jobs: examples,
      turn_count: turnCount + 1,
      status: reply.status ?? 'in_progress',
    }),
  };
}

async function guidedReply(
  admin: SupabaseClient,
  ctx: LiteContext,
  chat: SetupChat,
  text: string,
  saved: ExampleJob[],
  interviewId: string,
  recent: InterviewMessage[],
): Promise<{ content: string; chat: SetupChat; stage: Stage; examples?: ExampleJob[]; status?: 'finished' }> {
  if (chat.mode === 'examples') return replyToExample(admin, ctx, chat, saved, interviewId, recent);
  if (chat.mode === 'website') return replyToWebsite(admin, ctx, chat, text);
  if (chat.mode === 'signoff') return replyToSignOff(admin, ctx, chat, text);
  return replyToMobile(admin, ctx, chat, text, saved, interviewId);
}

async function rewriteExampleDescriptions(
  admin: SupabaseClient,
  ctx: LiteContext,
  interviewId: string,
  jobs: string[],
): Promise<string[] | null> {
  if (jobs.length === 0) return [];
  const model = await askModel(admin, {
    tenantId: ctx.tenantId,
    interviewId,
    stage: 'examples',
    schema: ExampleDetailSchema,
    system: [{ type: 'text', text: buildExampleDetailPrompt(businessOf(ctx), jobs) }],
    messages: [{ role: 'user', content: 'Rewrite the jobs so they can be priced.' }],
  });
  if (!model.ok || model.value.examples.length === 0) return null;
  const got = model.value.examples.map((example) => example.description.trim().slice(0, 300)).filter((description) => description !== '');
  if (got.length === 0) return null;
  if (got.length >= jobs.length) return got.slice(0, jobs.length);
  return jobs.map((job, index) => got[index] || job);
}

async function waitForExampleDetail(admin: SupabaseClient, tenantId: string, interviewId: string): Promise<InterviewView | null> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const row = await loadById(admin, tenantId, interviewId);
    if (!row) return null;
    const chat = readSetupChat(asDraft(row.draft_profile));
    if (chat?.detailed) return viewFrom(row);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

/** Fills quantity or size into example jobs that were written too thin, including the one on screen. */
export async function fillExampleDetail(
  admin: SupabaseClient,
  ctx: LiteContext,
  interviewId: string,
): Promise<{ ok: true; view: InterviewView } | { ok: false; error: string }> {
  const row = await loadById(admin, ctx.tenantId, interviewId);
  if (!row || row.status !== 'in_progress') return { ok: false, error: 'That interview could not be found.' };
  const draft = asDraft(row.draft_profile);
  const chat = readSetupChat(draft);
  if (!chat || chat.mode !== 'examples' || chat.detailed) return { ok: true, view: viewFrom(row) };

  const from = Math.max(0, chat.cursor);
  const pending = chat.prompts.slice(from);
  const turnCount = typeof row.turn_count === 'number' ? row.turn_count : 0;
  const claimed = await claimTurn(admin, ctx, interviewId, turnCount, { turn_count: turnCount + 1 });
  if (!claimed) {
    const waited = await waitForExampleDetail(admin, ctx.tenantId, interviewId);
    if (waited) return { ok: true, view: waited };
    return { ok: false, error: "Couldn't add the details just then — try again." };
  }

  const rewritten = await rewriteExampleDescriptions(admin, ctx, interviewId, pending);
  if (!rewritten) return { ok: false, error: "Couldn't add the details just then — try again." };
  const prompts = [...chat.prompts.slice(0, from), ...rewritten];
  const messages = asMessages(row.messages);
  const current = prompts[from] ?? '';
  const last = messages[messages.length - 1];
  const old = chat.prompts[from] ?? '';
  if (last?.role === 'assistant' && old && last.content.includes(old)) {
    messages[messages.length - 1] = { role: 'assistant', content: exampleQuestion(current, from) };
  }
  const nextDraft = withChat(draft, { ...chat, prompts, detail_version: 2 });
  await admin
    .from('lite_interviews')
    .update({ messages, draft_profile: nextDraft })
    .eq('id', interviewId)
    .eq('tenant_id', ctx.tenantId)
    .eq('turn_count', turnCount + 1);
  return {
    ok: true,
    view: guidedView(row, { messages, draft_profile: nextDraft, turn_count: turnCount + 1 }),
  };
}

const ANSWER_FALLBACK = 'Tell me the total for this job, and in a few words what made it that amount.';

type ExampleAnswer = {
  outcome: 'priced' | 'need_reason' | 'need_detail' | 'skip_job' | 'skip_rest';
  reply: string;
  price: number | null;
  reasoning: string | null;
  replaces_total: boolean;
};

async function interpretExampleAnswer(
  admin: SupabaseClient,
  ctx: LiteContext,
  interviewId: string,
  description: string,
  pendingPrice: number | undefined,
  recent: InterviewMessage[],
): Promise<ExampleAnswer | null> {
  const history = recent.slice(-8);
  const messages =
    history[0]?.role === 'user' ? history : [{ role: 'user' as const, content: 'The owner is pricing this job.' }, ...history];
  const model = await askModel(admin, {
    tenantId: ctx.tenantId,
    interviewId,
    stage: 'examples',
    schema: ExampleAnswerSchema,
    system: [
      {
        type: 'text',
        text: buildExampleAnswerPrompt(businessOf(ctx), description || 'the job just described', pendingPrice),
      },
    ],
    messages,
  });
  if (!model.ok) return null;
  const price = model.value.price;
  const reasoning = model.value.reasoning?.trim() ?? '';
  return {
    outcome: model.value.outcome,
    reply: model.value.reply.trim(),
    price: typeof price === 'number' && Number.isFinite(price) ? price : null,
    reasoning: reasoning.length > 0 ? reasoning.slice(0, 400) : null,
    replaces_total: model.value.replaces_total === true,
  };
}

/** A breakdown does not replace a total already given, unless this message clearly changes it. */
function totalForJob(answer: ExampleAnswer, pending: number | undefined): number | null {
  const stated = answer.price;
  if (pending == null) return stated;
  if (stated == null || stated === pending || !answer.replaces_total) return pending;
  return stated;
}

function withoutPending(chat: SetupChat): SetupChat {
  const next = { ...chat };
  delete next.pending_price;
  return next;
}

function pricedExample(answer: ExampleAnswer): { price: number; reasoning: string } | null {
  if (answer.outcome !== 'priced' || answer.price == null || answer.reasoning == null) return null;
  if (answer.price <= 0 || answer.price > 50000 || answer.reasoning.length < 5) return null;
  return { price: answer.price, reasoning: answer.reasoning };
}

async function replyToExample(
  admin: SupabaseClient,
  ctx: LiteContext,
  chat: SetupChat,
  saved: ExampleJob[],
  interviewId: string,
  recent: InterviewMessage[],
): Promise<{ content: string; chat: SetupChat; stage: Stage; examples?: ExampleJob[] }> {
  const description = chat.prompts[chat.cursor] ?? '';
  const remainingAfter = chat.prompts.length - (chat.cursor + 1);
  const answer = await interpretExampleAnswer(admin, ctx, interviewId, description, chat.pending_price, recent);
  if (!answer) return { content: ANSWER_FALLBACK, chat, stage: 'examples' };
  const held = totalForJob(answer, chat.pending_price);

  if (answer.outcome === 'skip_rest') {
    if (saved.length >= 3) {
      const ack = answer.reply || "Okay, that's enough to learn from.";
      return {
        content: `${ack} ${WEBSITE_QUESTION}`,
        chat: { ...withoutPending(chat), mode: 'website' },
        stage: 'website',
      };
    }
    return {
      content: `I still need a few priced jobs before we move on. ${exampleQuestion(description, chat.cursor)}`,
      chat,
      stage: 'examples',
    };
  }

  if (answer.outcome === 'skip_job') {
    if (saved.length + remainingAfter >= 3 && chat.cursor + 1 < chat.prompts.length) {
      const cursor = chat.cursor + 1;
      const ack = answer.reply || "No problem, we'll leave that one.";
      return {
        content: `${ack} ${exampleQuestion(chat.prompts[cursor] ?? '', cursor)}`,
        chat: { ...withoutPending(chat), cursor },
        stage: 'examples',
      };
    }
    return {
      content: `I need this one so I've got a few to learn from. ${exampleQuestion(description, chat.cursor)}`,
      chat,
      stage: 'examples',
    };
  }

  if (answer.outcome === 'need_reason' || (answer.outcome === 'priced' && held != null && !pricedExample({ ...answer, price: held }))) {
    return {
      content: answer.reply || 'What made it that amount?',
      chat: held != null ? { ...chat, pending_price: held } : chat,
      stage: 'examples',
    };
  }

  const priced = pricedExample({ ...answer, price: held });
  if (!priced) {
    return { content: answer.reply || ANSWER_FALLBACK, chat, stage: 'examples' };
  }

  const examples = [...saved, { description, price: priced.price, reasoning: priced.reasoning }];
  const cursor = chat.cursor + 1;
  const ack = answer.reply || `${pounds(priced.price)}, noted.`;
  const nextChat = withoutPending(chat);
  if (cursor < chat.prompts.length) {
    return {
      content: `${ack} ${exampleQuestion(chat.prompts[cursor] ?? '', cursor)}`,
      chat: { ...nextChat, cursor },
      stage: 'examples',
      examples,
    };
  }
  return {
    content: `${ack} ${WEBSITE_QUESTION}`,
    chat: { ...nextChat, mode: 'website', cursor, website: undefined, signOff: undefined },
    stage: 'website',
    examples,
  };
}

async function replyToWebsite(
  admin: SupabaseClient,
  ctx: LiteContext,
  chat: SetupChat,
  text: string,
): Promise<{ content: string; chat: SetupChat; stage: Stage }> {
  const website = websiteFromMessage(text);
  if (!website) {
    return { content: `${WEBSITE_ERROR} ${WEBSITE_QUESTION}`, chat, stage: 'website' };
  }
  const suggested = await suggestedSignOff(admin, ctx);
  return {
    content: signOffQuestion(suggested),
    chat: { ...chat, mode: 'signoff', website },
    stage: 'website',
  };
}

async function replyToSignOff(
  admin: SupabaseClient,
  ctx: LiteContext,
  chat: SetupChat,
  text: string,
): Promise<{ content: string; chat: SetupChat; stage: Stage }> {
  const suggested = await suggestedSignOff(admin, ctx);
  const signOff = signOffFrom(text, suggested);
  if (!signOff) {
    return { content: `Keep that name to a few words. ${signOffQuestion(suggested)}`, chat, stage: 'website' };
  }
  return {
    content: MOBILE_QUESTION,
    chat: { ...chat, mode: 'mobile', signOff },
    stage: 'website',
  };
}

async function replyToMobile(
  admin: SupabaseClient,
  ctx: LiteContext,
  chat: SetupChat,
  text: string,
  saved: ExampleJob[],
  interviewId: string,
): Promise<{ content: string; chat: SetupChat; stage: Stage; examples?: ExampleJob[]; status?: 'finished' }> {
  const mobile = mobileFrom(text);
  if (!mobile.ok) {
    return { content: `Use a UK mobile number, like 07700 900123. ${MOBILE_QUESTION}`, chat, stage: 'website' };
  }
  const savedWebsite = await saveWebsiteStep(admin, ctx, {
    interviewId,
    website: chat.website ?? '',
    signOffName: chat.signOff ?? '',
    ownerMobile: mobile.mobile,
  });
  if (!savedWebsite.ok) {
    return { content: `${savedWebsite.error} ${MOBILE_QUESTION}`, chat, stage: 'website' };
  }
  const finished = await finishInterview(admin, ctx, interviewId);
  if (!finished.ok) {
    return { content: finished.missing.join(' '), chat, stage: 'website', examples: saved };
  }
  return {
    content: "That's everything. Your website chat is ready.",
    chat,
    stage: 'done',
    examples: saved,
    status: 'finished',
  };
}

export async function suggestExampleJobs(
  admin: SupabaseClient,
  ctx: LiteContext,
  interviewId: string,
): Promise<{ ok: true; examples: { description: string; job_type_key: string }[] } | { ok: false; error: string }> {
  const row = await loadById(admin, ctx.tenantId, interviewId);
  if (!row || row.status !== 'in_progress') return { ok: false, error: 'That interview could not be found.' };
  const draft = viewFrom(row).draft;
  const jobs = draft.job_types ?? [];
  if (jobs.length < 1) return { ok: false, error: 'Tell it about at least one kind of work first.' };

  const known = new Set(jobs.map((job) => job.key));
  const model = await askModel(admin, {
    tenantId: ctx.tenantId,
    interviewId,
    stage: 'examples',
    schema: ExampleSuggestionsSchema,
    system: [
      {
        type: 'text',
        text: buildExampleSystemPrompt(businessOf(ctx), jobs.map((job) => ({ key: job.key, name: job.name }))),
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: 'Suggest the example jobs.' }],
  });
  if (!model.ok) return { ok: false, error: "I couldn't think of examples just then — try again." };

  const examples = model.value.examples
    .map((example) => ({
      description: example.description.trim().slice(0, 300),
      job_type_key: example.job_type_key,
    }))
    .filter((example) => example.description !== '' && known.has(example.job_type_key))
    .slice(0, 5);
  if (examples.length < 3) return { ok: false, error: "I couldn't think of examples just then — try again." };
  await safeLog(admin, {
    tenantId: ctx.tenantId,
    interactionType: 'lite_interview',
    prompt: 'lite_interview',
    inputData: { interviewId, stage: 'examples' },
    parsedOutput: { suggestions: examples.length },
    model: INTERVIEW_AI_MODEL,
    tokensInput: model.tokensIn,
    tokensOutput: model.tokensOut,
    latencyMs: model.latencyMs,
  });
  return { ok: true, examples };
}

function exampleError(examples: { description: string; price: number; reasoning: string }[]): string | null {
  if (examples.length > 10) return 'Keep it to 10 example jobs.';
  for (const example of examples) {
    const description = example.description?.trim() ?? '';
    const reasoning = example.reasoning?.trim() ?? '';
    const price = example.price;
    if (description.length < 1) return 'Each example needs a description.';
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0 || price > 50000) {
      return 'Each example needs a price above £0.';
    }
    if (reasoning.length < 5) return 'Say why that price, in a few words.';
  }
  return null;
}

export async function saveExampleJobs(
  admin: SupabaseClient,
  ctx: LiteContext,
  p: { interviewId: string; examples: { description: string; price: number; reasoning: string }[] },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await loadById(admin, ctx.tenantId, p.interviewId);
  if (!row || row.status !== 'in_progress') return { ok: false, error: 'That interview could not be found.' };
  const problem = exampleError(p.examples);
  if (problem) return { ok: false, error: problem };

  const examples: ExampleJob[] = p.examples.map((example) => ({
    description: example.description.trim().slice(0, 300),
    price: example.price,
    reasoning: example.reasoning.trim().slice(0, 400),
  }));
  const draft = { ...asDraft(row.draft_profile), example_jobs: examples };
  const { error } = await admin
    .from('lite_interviews')
    .update({ example_jobs: examples, draft_profile: draft })
    .eq('id', p.interviewId)
    .eq('tenant_id', ctx.tenantId)
    .eq('status', 'in_progress');
  if (error) return { ok: false, error: "Couldn't save those examples. Try again." };
  return { ok: true };
}

export async function saveWebsiteStep(
  admin: SupabaseClient,
  ctx: LiteContext,
  p: { interviewId: string; website: string; signOffName: string; ownerMobile: string | null },
): Promise<{ ok: true } | { ok: false; field: 'website' | 'signOffName' | 'ownerMobile'; error: string }> {
  const row = await loadById(admin, ctx.tenantId, p.interviewId);
  if (!row || row.status !== 'in_progress') {
    return { ok: false, field: 'website', error: 'That interview could not be found.' };
  }

  const host = normaliseWebsite(p.website);
  if (!host) return { ok: false, field: 'website', error: WEBSITE_ERROR };

  const signOff = p.signOffName.trim();
  if (signOff.length < 1) return { ok: false, field: 'signOffName', error: 'Add the name customers will see.' };
  if (signOff.length > 40) return { ok: false, field: 'signOffName', error: 'Keep that name to 40 characters.' };

  let mobile: string | null = null;
  const rawMobile = p.ownerMobile?.trim() ?? '';
  if (rawMobile !== '') {
    const e164 = normalizeUkPhoneE164(rawMobile);
    if (!e164 || !MOBILE_RE.test(e164)) {
      return { ok: false, field: 'ownerMobile', error: 'Use a UK mobile number, like 07700 900123.' };
    }
    mobile = e164;
  }

  const { data: widget, error: widgetError } = await admin
    .from('widget_clients')
    .update({
      allowed_domains: [host],
      website_url: host,
      sign_off_name: signOff,
      owner_mobile_e164: mobile,
    })
    .eq('id', ctx.widget.id)
    .eq('tenant_id', ctx.tenantId)
    .select('id');
  if (widgetError || !widget || widget.length === 0) {
    return { ok: false, field: 'website', error: "Couldn't save that. Try again." };
  }

  const { error } = await admin
    .from('lite_interviews')
    .update({ stage: 'website' })
    .eq('id', p.interviewId)
    .eq('tenant_id', ctx.tenantId)
    .eq('status', 'in_progress');
  if (error) return { ok: false, field: 'website', error: "Couldn't save that. Try again." };
  return { ok: true };
}

async function profileVersion(admin: SupabaseClient, tenantId: string): Promise<number> {
  const { data } = await admin.from('lite_price_profiles').select('version').eq('tenant_id', tenantId).maybeSingle();
  const version = (data as Row | null)?.version;
  return typeof version === 'number' && Number.isFinite(version) ? version : 0;
}

function profileFrom(draft: DraftProfile, examples: ExampleJob[]): PriceProfile | null {
  const candidate = {
    areas: {
      summary: draft.areas?.summary?.trim().slice(0, 300) ?? '',
      postcodes: draft.areas?.postcodes ?? [],
      max_miles: draft.areas?.max_miles ?? null,
    },
    callout_fee: draft.callout_fee ?? null,
    hourly_rate: draft.hourly_rate ?? null,
    day_rate: draft.day_rate ?? null,
    minimum_charge: draft.minimum_charge ?? null,
    materials: draft.materials ?? '',
    job_types: (draft.job_types ?? []).map((job) => ({
      ...job,
      auto_accept: job.how_priced === 'from_description' && job.auto_accept === true,
    })),
    rules: draft.rules ?? [],
    example_jobs: examples.slice(0, 10).map((example) => ({
      description: example.description.trim(),
      price: example.price,
      reasoning: example.reasoning.trim(),
    })),
    tone: draft.tone ?? '',
  };
  const parsed = PriceProfileSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export async function finishInterview(
  admin: SupabaseClient,
  ctx: LiteContext,
  interviewId: string,
): Promise<{ ok: true; version: number } | { ok: false; missing: string[] }> {
  const row = await loadById(admin, ctx.tenantId, interviewId);
  if (!row) return { ok: false, missing: ['That interview could not be found.'] };
  const currentVersion = await profileVersion(admin, ctx.tenantId);
  if (row.status === 'finished') return { ok: true, version: currentVersion || 1 };

  if (row.status !== 'in_progress') return { ok: false, missing: ['That interview could not be found.'] };

  const current = viewFrom(row);
  const { data: widget } = await admin
    .from('widget_clients')
    .select('website_url')
    .eq('id', ctx.widget.id)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  const websiteValue = (widget as Row | null)?.website_url;
  const website = typeof websiteValue === 'string' ? websiteValue.trim() : '';
  const missing = missingForFinish(current.draft, website || null);
  if (missing.length > 0) return { ok: false, missing };

  const profile = profileFrom(current.draft, current.examples);
  if (!profile) return { ok: false, missing: ['Some answers still need a check before this can go live.'] };

  const version = currentVersion + 1;
  const { error: upsertError } = await admin.from('lite_price_profiles').upsert(
    { tenant_id: ctx.tenantId, profile, version, interview_id: interviewId },
    { onConflict: 'tenant_id' },
  );
  if (upsertError) return { ok: false, missing: ["Couldn't save that. Try again."] };

  const finishedAt = new Date().toISOString();
  const { data: updated, error: updateError } = await admin
    .from('lite_interviews')
    .update({ status: 'finished', stage: 'done', finished_at: finishedAt })
    .eq('id', interviewId)
    .eq('tenant_id', ctx.tenantId)
    .eq('status', 'in_progress')
    .select('id');
  if (updateError) return { ok: false, missing: ["Couldn't save that. Try again."] };
  // The other tab already finished. The profile is the same one we just wrote.
  if (!updated || updated.length === 0) return { ok: true, version };
  return { ok: true, version };
}

type ProfileStamp = { profile: unknown; updatedAt: string };

function applyAutoAccept(
  raw: unknown,
  p: { key: string; on: boolean },
): { ok: true; profile: PriceProfile } | { ok: false; error: 'save_failed' | 'no_such_work' | 'needs_visit' } {
  const profile = parseProfile(raw);
  if (!profile) return { ok: false, error: 'save_failed' };
  const index = profile.job_types.findIndex((job) => job.key === p.key);
  if (index < 0) return { ok: false, error: 'no_such_work' };
  const job = profile.job_types[index];
  if (p.on && job.how_priced !== 'from_description') return { ok: false, error: 'needs_visit' };
  const next: PriceProfile = {
    ...profile,
    job_types: profile.job_types.map((item, itemIndex) =>
      itemIndex === index ? { ...item, auto_accept: p.on && item.how_priced === 'from_description' } : item,
    ),
  };
  const checked = PriceProfileSchema.safeParse(next);
  if (!checked.success) return { ok: false, error: 'save_failed' };
  return { ok: true, profile: checked.data };
}

async function readPricedProfile(admin: SupabaseClient, tenantId: string): Promise<ProfileStamp | null | 'error'> {
  const { data, error } = await admin
    .from('lite_price_profiles')
    .select('profile, updated_at')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) return 'error';
  if (!data) return null;
  const stamp = (data as Row).updated_at;
  if (typeof stamp !== 'string' || stamp === '') return 'error';
  return { profile: (data as Row).profile, updatedAt: stamp };
}

async function writePricedProfile(
  admin: SupabaseClient,
  tenantId: string,
  profile: PriceProfile,
  updatedAt: string,
): Promise<'ok' | 'miss' | 'error'> {
  const { data, error } = await admin
    .from('lite_price_profiles')
    .update({ profile })
    .eq('tenant_id', tenantId)
    .eq('updated_at', updatedAt)
    .select('tenant_id');
  if (error) return 'error';
  if (!data || data.length === 0) return 'miss';
  return 'ok';
}

/** Flip one kind of work's auto-accept. Off is always allowed; on only when it is priced from a description. */
export async function setAutoAccept(
  admin: SupabaseClient,
  ctx: LiteContext,
  p: { key: string; on: boolean },
): Promise<{ ok: true } | { ok: false; error: 'no_profile' | 'no_such_work' | 'needs_visit' | 'save_failed' }> {
  const attempt = async (stamp: ProfileStamp) => {
    const applied = applyAutoAccept(stamp.profile, p);
    if (!applied.ok) return applied;
    const wrote = await writePricedProfile(admin, ctx.tenantId, applied.profile, stamp.updatedAt);
    return wrote;
  };

  const first = await readPricedProfile(admin, ctx.tenantId);
  if (first === 'error') return { ok: false, error: 'save_failed' };
  if (!first) return { ok: false, error: 'no_profile' };
  const firstWrite = await attempt(first);
  if (firstWrite === 'ok') return { ok: true };
  if (typeof firstWrite === 'object') return firstWrite;
  if (firstWrite === 'error') return { ok: false, error: 'save_failed' };

  const second = await readPricedProfile(admin, ctx.tenantId);
  if (second === 'error') return { ok: false, error: 'save_failed' };
  if (!second) return { ok: false, error: 'no_profile' };
  const secondWrite = await attempt(second);
  if (secondWrite === 'ok') return { ok: true };
  if (typeof secondWrite === 'object') return secondWrite;
  return { ok: false, error: 'save_failed' };
}
