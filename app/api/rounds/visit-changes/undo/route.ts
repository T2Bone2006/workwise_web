import {
  actorForUser,
  firstZodError,
  readJsonBody,
  requireRoundsApi,
  roundsJson,
} from '@/lib/api/rounds-request';
import {
  notifyVisitChangeUndone,
  type NoticeCounts,
} from '@/lib/messaging/visit-change-notices';
import { undoVisitChangeCore } from '@/lib/rounds/visit-changes';
import { undoVisitChangeSchema } from '@/lib/validations/rounds/visit';

export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = undoVisitChangeSchema.safeParse(json.body);
  if (!parsed.success) {
    return roundsJson({ error: firstZodError(parsed.error) }, 400);
  }

  const actor = await actorForUser(auth.ctx.supabase, auth.ctx.userId);
  const result = await undoVisitChangeCore(auth.ctx.supabase, {
    tenantId: auth.ctx.tenantId,
    changeId: parsed.data.changeId,
    actor,
  });
  if (!result.success) {
    if (result.error === 'Already undone') {
      return roundsJson({ error: result.error, code: 'already_undone' }, 409);
    }
    if (result.error === 'Too old to undo') {
      return roundsJson({ error: result.error, code: 'too_old' }, 409);
    }
    return roundsJson({ error: result.error }, 400);
  }

  let notified: NoticeCounts | undefined;
  if (result.change.notifiedAt && parsed.data.notifyCustomers !== false) {
    try {
      notified = await notifyVisitChangeUndone({
        tenantId: auth.ctx.tenantId,
        changeId: result.change.id,
        restoredJobIds: result.restoredJobIds,
      });
    } catch (err) {
      console.error(
        '[POST /api/rounds/visit-changes/undo] notify',
        err instanceof Error ? err.message : 'failed',
      );
    }
  }

  return roundsJson({
    success: true,
    restored: result.restored,
    leftAlone: result.leftAlone,
    ...(notified ? { notified } : {}),
  });
}
