import 'server-only';

import { covers, type AssistantCtx } from '@/lib/assistant/caller';
import { ACTIONS_BY_KIND } from '@/lib/assistant/registry';
import type { AssistantAction } from '@/lib/assistant/shared';
import { ACTION_EXPIRY_MS, actionCard, claimAction, finishAction, getAction, touchConversation } from '@/lib/assistant/store';

type Decision = 'confirm' | 'cancel' | 'undo';
type Outcome = { status: number; body: { action?: AssistantAction; error?: string } };

/**
 * The only place an assistant change actually happens: after the trader taps
 * Do it. The row is claimed first (pending → running) so a double tap, a second
 * tab or the phone and laptop together can't run it twice.
 */
export async function decideAction(ctx: AssistantCtx, id: string, decision: Decision): Promise<Outcome> {
  const row = await getAction(ctx.admin, { id, userId: ctx.userId, tenantId: ctx.tenantId });
  if (!row) return { status: 404, body: { error: 'Not found' } };
  const def = ACTIONS_BY_KIND.get(row.kind);
  if (!def) return { status: 400, body: { error: 'Unknown action' } };
  const hasUndo = Boolean(def.undo);
  // Working through the cards keeps the chat from clearing itself.
  await touchConversation(ctx.admin, row.conversation_id);
  const card = (r: typeof row) => ({ status: 200, body: { action: actionCard(r, hasUndo) } });
  const now = Date.now();

  if (decision === 'cancel') {
    if (!(await claimAction(ctx.admin, row.id, 'pending', 'cancelled'))) return { status: 409, body: { action: actionCard(row, hasUndo) } };
    return card({ ...row, status: 'cancelled' });
  }

  if (decision === 'confirm') {
    if (row.status === 'pending' && now - new Date(row.created_at).getTime() > ACTION_EXPIRY_MS) {
      const expired = await finishAction(ctx.admin, row.id, { status: 'expired' });
      return card(expired ?? { ...row, status: 'expired' });
    }
    if (!covers(ctx, def.product)) return { status: 403, body: { error: 'That part of WorkWise is not on your plan.' } };
    if (!(await claimAction(ctx.admin, row.id, 'pending', 'running'))) return { status: 409, body: { action: actionCard(row, hasUndo) } };

    let updated;
    try {
      const done = await def.execute(ctx, row.params, row.id);
      updated = done.ok
        ? await finishAction(ctx.admin, row.id, {
            status: 'done',
            result: { text: done.result, data: done.data ?? {}, href: done.href },
            changeId: done.changeId ?? null,
          })
        : await finishAction(ctx.admin, row.id, { status: 'failed', error: done.error });
    } catch (err) {
      console.error(`[assistant] execute ${row.kind}`, err instanceof Error ? err.message : err);
      updated = await finishAction(ctx.admin, row.id, { status: 'failed', error: 'Something went wrong. Nothing was changed.' });
    }
    return updated ? card(updated) : { status: 500, body: { error: 'Could not save the result' } };
  }

  // Undo
  if (!def.undo || row.status !== 'done') return { status: 409, body: { action: actionCard(row, hasUndo) } };
  if (now - new Date(row.decided_at ?? row.created_at).getTime() > ACTION_EXPIRY_MS) {
    return { status: 409, body: { action: actionCard(row, hasUndo), error: 'Too long ago to undo here.' } };
  }
  if (!(await claimAction(ctx.admin, row.id, 'done', 'running'))) return { status: 409, body: { action: actionCard(row, hasUndo) } };
  let updated;
  try {
    const undone = await def.undo(ctx, row.params, { data: row.result?.data ?? {}, changeId: row.change_id });
    updated = undone.ok
      ? await finishAction(ctx.admin, row.id, { status: 'undone', result: { ...(row.result ?? {}), undo: undone.result } })
      : await finishAction(ctx.admin, row.id, { status: 'done', result: row.result, error: `Couldn't undo: ${undone.error}` });
  } catch (err) {
    console.error(`[assistant] undo ${row.kind}`, err instanceof Error ? err.message : err);
    updated = await finishAction(ctx.admin, row.id, { status: 'done', result: row.result, error: "Couldn't undo that." });
  }
  return updated ? card(updated) : { status: 500, body: { error: 'Could not save the result' } };
}
