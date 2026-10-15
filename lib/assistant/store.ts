import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Preview } from '@/lib/assistant/actions/types';
import type {
  ActionStatus,
  AssistantAction,
  AssistantPart,
  AssistantTurn,
} from '@/lib/assistant/shared';
import { londonDayBoundsUtc, type Ymd } from '@/lib/rounds/dates';

/*
 * The assistant's own tables are server-only (service role). Every function
 * here filters by the caller's user or tenant itself: the route has already
 * checked who is asking, and these never trust an id on its own.
 */

export type ConversationRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  title: string;
  system_prompt: string;
  products: string[];
  surface: 'web' | 'phone';
  updated_at: string;
};

export type MessageRow = {
  id: string;
  seq: number;
  role: 'user' | 'assistant';
  kind: 'question' | 'answer' | 'tool_results';
  content: Anthropic.ContentBlockParam[];
  ui: { parts: StoredPart[] } | null;
  created_at: string;
};

/** Actions are stored by id in ui, so their status is always read fresh. */
export type StoredPart = { type: 'text'; text: string } | Extract<AssistantPart, { type: 'card' }> | { type: 'action'; id: string };

export type ActionRow = {
  id: string;
  conversation_id: string;
  tenant_id: string;
  user_id: string;
  tool_use_id: string;
  kind: string;
  params: unknown;
  preview: Preview;
  status: ActionStatus;
  result: { text?: string; data?: Record<string, unknown>; href?: string; undo?: string } | null;
  error: string | null;
  change_id: string | null;
  created_at: string;
  decided_at: string | null;
  noted_at: string | null;
};

const CONVERSATION_COLS = 'id, tenant_id, user_id, title, system_prompt, products, surface, updated_at';
const ACTION_COLS =
  'id, conversation_id, tenant_id, user_id, tool_use_id, kind, params, preview, status, result, error, change_id, created_at, decided_at, noted_at';

export async function createConversation(
  admin: SupabaseClient,
  p: { tenantId: string; userId: string; title: string; systemPrompt: string; products: string[]; surface: 'web' | 'phone' },
): Promise<ConversationRow | null> {
  const { data, error } = await admin
    .from('assistant_conversations')
    .insert({
      tenant_id: p.tenantId,
      user_id: p.userId,
      title: p.title.slice(0, 120) || 'New chat',
      system_prompt: p.systemPrompt,
      products: p.products,
      surface: p.surface,
    })
    .select(CONVERSATION_COLS)
    .single();
  if (error || !data) {
    console.error('[assistant] create conversation', error?.message);
    return null;
  }
  return data as ConversationRow;
}

export async function getConversation(admin: SupabaseClient, p: { id: string; userId: string; tenantId: string }): Promise<ConversationRow | null> {
  const { data } = await admin
    .from('assistant_conversations')
    .select(CONVERSATION_COLS)
    .eq('id', p.id)
    .eq('user_id', p.userId)
    .eq('tenant_id', p.tenantId)
    .is('deleted_at', null)
    .maybeSingle();
  return (data as ConversationRow | null) ?? null;
}

/** A chat clears itself after this long without a question or a tap on a card. */
export const SESSION_IDLE_MS = 45 * 60 * 1000;

export function isStale(conversation: Pick<ConversationRow, 'updated_at'>, now: Date = new Date()): boolean {
  return now.getTime() - new Date(conversation.updated_at).getTime() > SESSION_IDLE_MS;
}

/** The chat this person is in the middle of on this device, if any (used in the last 45 minutes, not cleared). */
export async function getActiveConversation(
  admin: SupabaseClient,
  p: { userId: string; tenantId: string; surface: 'web' | 'phone'; now?: Date },
): Promise<ConversationRow | null> {
  const since = new Date((p.now ?? new Date()).getTime() - SESSION_IDLE_MS).toISOString();
  const { data } = await admin
    .from('assistant_conversations')
    .select(CONVERSATION_COLS)
    .eq('user_id', p.userId)
    .eq('tenant_id', p.tenantId)
    .eq('surface', p.surface)
    .is('deleted_at', null)
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ConversationRow | null) ?? null;
}

/** Changes made through the assistant today (London), newest first: the "Done today" list. */
export async function actionsDoneToday(
  admin: SupabaseClient,
  p: { userId: string; tenantId: string; today: Ymd },
): Promise<ActionRow[]> {
  const { data } = await admin
    .from('assistant_actions')
    .select(ACTION_COLS)
    .eq('user_id', p.userId)
    .eq('tenant_id', p.tenantId)
    .in('status', ['done', 'undone'])
    .gte('decided_at', londonDayBoundsUtc(p.today).startIso)
    .order('decided_at', { ascending: false })
    .limit(30);
  return (data ?? []) as ActionRow[];
}

export async function deleteConversation(admin: SupabaseClient, p: { id: string; userId: string; tenantId: string }): Promise<boolean> {
  const { data } = await admin
    .from('assistant_conversations')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', p.id)
    .eq('user_id', p.userId)
    .eq('tenant_id', p.tenantId)
    .select('id');
  return (data ?? []).length > 0;
}

export async function touchConversation(admin: SupabaseClient, id: string): Promise<void> {
  await admin.from('assistant_conversations').update({ updated_at: new Date().toISOString() }).eq('id', id);
}

export async function loadMessages(admin: SupabaseClient, conversationId: string): Promise<MessageRow[]> {
  const { data, error } = await admin
    .from('assistant_messages')
    .select('id, seq, role, kind, content, ui, created_at')
    .eq('conversation_id', conversationId)
    .order('seq', { ascending: true })
    .limit(2000);
  if (error) throw new Error('Could not load the chat');
  return (data ?? []) as MessageRow[];
}

export async function appendMessage(
  admin: SupabaseClient,
  p: {
    conversationId: string;
    tenantId: string;
    role: 'user' | 'assistant';
    kind: MessageRow['kind'];
    content: Anthropic.ContentBlockParam[];
    ui: { parts: StoredPart[] } | null;
    tokensInput?: number;
    tokensOutput?: number;
  },
): Promise<void> {
  const { error } = await admin.from('assistant_messages').insert({
    conversation_id: p.conversationId,
    tenant_id: p.tenantId,
    role: p.role,
    kind: p.kind,
    content: p.content,
    ui: p.ui,
    tokens_input: p.tokensInput ?? null,
    tokens_output: p.tokensOutput ?? null,
  });
  if (error) throw new Error(`Could not save the chat: ${error.message}`);
}

/** Questions asked this London calendar month by the whole business. */
export async function questionsThisMonth(admin: SupabaseClient, tenantId: string, today: Ymd): Promise<number> {
  const start = londonDayBoundsUtc(`${today.slice(0, 7)}-01`).startIso;
  const { count, error } = await admin
    .from('assistant_messages')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('kind', 'question')
    .gte('created_at', start);
  if (error) throw new Error('Could not check the allowance');
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Actions

export async function insertAction(
  admin: SupabaseClient,
  p: { conversationId: string; tenantId: string; userId: string; toolUseId: string; kind: string; params: unknown; preview: Preview },
): Promise<ActionRow | null> {
  const { data, error } = await admin
    .from('assistant_actions')
    .insert({
      conversation_id: p.conversationId,
      tenant_id: p.tenantId,
      user_id: p.userId,
      tool_use_id: p.toolUseId,
      kind: p.kind,
      params: p.params,
      preview: p.preview,
    })
    .select(ACTION_COLS)
    .single();
  if (error || !data) {
    console.error('[assistant] insert action', error?.message);
    return null;
  }
  return data as ActionRow;
}

export async function getAction(admin: SupabaseClient, p: { id: string; userId: string; tenantId: string }): Promise<ActionRow | null> {
  const { data } = await admin
    .from('assistant_actions')
    .select(ACTION_COLS)
    .eq('id', p.id)
    .eq('user_id', p.userId)
    .eq('tenant_id', p.tenantId)
    .maybeSingle();
  return (data as ActionRow | null) ?? null;
}

export async function actionsForConversation(admin: SupabaseClient, conversationId: string): Promise<ActionRow[]> {
  const { data } = await admin.from('assistant_actions').select(ACTION_COLS).eq('conversation_id', conversationId).order('created_at');
  return (data ?? []) as ActionRow[];
}

/** Moves an action from one status to the next only if nobody else has (so Do it can't run twice). */
export async function claimAction(admin: SupabaseClient, id: string, from: ActionStatus, to: ActionStatus): Promise<boolean> {
  const { data } = await admin.from('assistant_actions').update({ status: to, decided_at: new Date().toISOString() }).eq('id', id).eq('status', from).select('id');
  return (data ?? []).length > 0;
}

export async function finishAction(
  admin: SupabaseClient,
  id: string,
  p: { status: ActionStatus; result?: ActionRow['result']; error?: string | null; changeId?: string | null },
): Promise<ActionRow | null> {
  const { data } = await admin
    .from('assistant_actions')
    .update({
      status: p.status,
      ...(p.result !== undefined ? { result: p.result } : {}),
      error: p.error ?? null,
      ...(p.changeId !== undefined ? { change_id: p.changeId } : {}),
      noted_at: null,
    })
    .eq('id', id)
    .select(ACTION_COLS)
    .single();
  return (data as ActionRow | null) ?? null;
}

/** Outcomes Claude hasn't been told about yet, oldest first; marked as told. */
export async function takeActionNotes(admin: SupabaseClient, conversationId: string): Promise<string[]> {
  const { data } = await admin
    .from('assistant_actions')
    .select('id, kind, status, preview, result, error')
    .eq('conversation_id', conversationId)
    .is('noted_at', null)
    .neq('status', 'pending')
    .neq('status', 'running')
    .order('created_at');
  const rows = (data ?? []) as Pick<ActionRow, 'id' | 'kind' | 'status' | 'preview' | 'result' | 'error'>[];
  if (rows.length === 0) return [];
  await admin.from('assistant_actions').update({ noted_at: new Date().toISOString() }).in('id', rows.map((r) => r.id));
  return rows.map((r) => {
    const what = `"${r.preview.title}"`;
    if (r.status === 'done') return `They tapped Do it on ${what}: ${r.result?.text ?? 'done'}`;
    if (r.status === 'undone') return `They did ${what}, then undid it: ${r.result?.undo ?? 'put back'}`;
    if (r.status === 'cancelled') return `They cancelled ${what}; nothing changed.`;
    if (r.status === 'failed') return `They tapped Do it on ${what} but it failed: ${r.error ?? 'unknown error'}. Nothing changed.`;
    return `${what} expired without being used.`;
  });
}

const EXPIRE_MS = 24 * 60 * 60 * 1000;

export function actionCard(row: ActionRow, hasUndo: boolean, now: Date = new Date()): AssistantAction {
  const expired = row.status === 'pending' && now.getTime() - new Date(row.created_at).getTime() > EXPIRE_MS;
  return {
    id: row.id,
    kind: row.kind,
    status: expired ? 'expired' : row.status,
    title: row.preview.title,
    lines: row.preview.lines,
    confirmLabel: row.preview.confirmLabel,
    tone: row.preview.tone,
    note: row.preview.note,
    result: row.status === 'undone' ? row.result?.undo : row.result?.text,
    error: row.error ?? undefined,
    canUndo: row.status === 'done' && hasUndo && now.getTime() - new Date(row.decided_at ?? row.created_at).getTime() < EXPIRE_MS,
    href: row.result?.href ?? row.preview.href,
  };
}

export const ACTION_EXPIRY_MS = EXPIRE_MS;

/** History rows → what the screen draws. Everything after a question is one assistant turn. */
export function renderTurns(rows: MessageRow[], actions: Map<string, AssistantAction>): AssistantTurn[] {
  const turns: AssistantTurn[] = [];
  for (const row of rows) {
    if (row.kind === 'question') {
      const text = (row.ui?.parts ?? []).filter((p): p is { type: 'text'; text: string } => p.type === 'text').map((p) => p.text).join('\n');
      turns.push({ id: row.id, role: 'user', parts: [{ type: 'text', text }], createdAt: row.created_at });
      continue;
    }
    const parts: AssistantPart[] = [];
    for (const p of row.ui?.parts ?? []) {
      if (p.type === 'action') {
        const a = actions.get(p.id);
        if (a) parts.push({ type: 'action', action: a });
      } else {
        parts.push(p);
      }
    }
    if (parts.length === 0) continue;
    const last = turns[turns.length - 1];
    if (last && last.role === 'assistant') last.parts.push(...parts);
    else turns.push({ id: row.id, role: 'assistant', parts, createdAt: row.created_at });
  }
  return turns;
}
