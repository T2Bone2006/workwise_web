import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAssistantCaller, type AssistantCtx } from '@/lib/assistant/caller';
import { ACTIONS_BY_KIND } from '@/lib/assistant/registry';
import { ASSISTANT_MONTHLY_QUESTIONS, type AssistantSession } from '@/lib/assistant/shared';
import {
  actionCard,
  actionsDoneToday,
  actionsForConversation,
  deleteConversation,
  getActiveConversation,
  getConversation,
  isStale,
  loadMessages,
  questionsThisMonth,
  renderTurns,
  type ConversationRow,
} from '@/lib/assistant/store';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const hasUndo = (kind: string) => Boolean(ACTIONS_BY_KIND.get(kind)?.undo);
const uuid = z.string().uuid();

/**
 * Which chat to carry on. The phone has one, found by device. The dashboard
 * has two kinds — the Your assistant page (it sends the id it was using) and
 * quick ask (always fresh, so it sends none) — so it must name the chat.
 * Either way a chat that's been quiet for 45 minutes is not carried on.
 */
async function currentChat(ctx: AssistantCtx, request: Request): Promise<ConversationRow | null> {
  if (ctx.surface === 'phone') {
    return getActiveConversation(ctx.admin, { userId: ctx.userId, tenantId: ctx.tenantId, surface: 'phone' });
  }
  const id = uuid.safeParse(new URL(request.url).searchParams.get('conversation'));
  if (!id.success) return null;
  const row = await getConversation(ctx.admin, { id: id.data, userId: ctx.userId, tenantId: ctx.tenantId });
  return row && !isStale(row) ? row : null;
}

/** What the assistant opens with: the chat still going (if any), today's changes, questions left. No list of old chats. */
export async function GET(request: Request) {
  const auth = await requireAssistantCaller(request);
  if (!auth.ok) return auth.response;
  const { admin, userId, tenantId, today } = auth.ctx;

  const [active, done, used] = await Promise.all([
    currentChat(auth.ctx, request),
    actionsDoneToday(admin, { userId, tenantId, today }),
    questionsThisMonth(admin, tenantId, today).catch(() => null),
  ]);

  let turns: AssistantSession['turns'] = [];
  if (active) {
    const [rows, actions] = await Promise.all([loadMessages(admin, active.id), actionsForConversation(admin, active.id)]);
    turns = renderTurns(rows, new Map(actions.map((a) => [a.id, actionCard(a, hasUndo(a.kind))])));
  }

  const session: AssistantSession = {
    conversationId: active?.id ?? null,
    turns,
    doneToday: done.map((a) => actionCard(a, hasUndo(a.kind))),
    questionsLeft: used == null ? null : Math.max(0, ASSISTANT_MONTHLY_QUESTIONS - used),
  };
  return json(session);
}

/** Clear: that chat ends now. Anything it changed stays, and stays in Done today. */
export async function DELETE(request: Request) {
  const auth = await requireAssistantCaller(request);
  if (!auth.ok) return auth.response;
  const active = await currentChat(auth.ctx, request);
  if (active) await deleteConversation(auth.ctx.admin, { id: active.id, userId: auth.ctx.userId, tenantId: auth.ctx.tenantId });
  return json({ cleared: true });
}
