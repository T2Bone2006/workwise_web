import {
  actorForUser,
  emptyToNull,
  firstZodError,
  readJsonBody,
  requireRoundsApi,
  roundsJson,
} from '@/lib/api/rounds-request';
import {
  notifyVisitChange,
  type NoticeCounts,
} from '@/lib/messaging/visit-change-notices';
import { moveRemainingWithLog } from '@/lib/rounds/visit-changes';
import { moveRemainingSchema } from '@/lib/validations/rounds/visit';

export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = moveRemainingSchema.safeParse(json.body);
  if (!parsed.success) {
    return roundsJson({ error: firstZodError(parsed.error) }, 400);
  }

  const notify = parsed.data.notifyCustomers ?? false;
  const actor = await actorForUser(auth.ctx.supabase, auth.ctx.userId);
  const result = await moveRemainingWithLog(auth.ctx.supabase, {
    tenantId: auth.ctx.tenantId,
    fromDate: parsed.data.fromDate,
    toDate: parsed.data.toDate,
    scheduledTime: emptyToNull(parsed.data.scheduledTime),
    actor,
    notifyCustomers: notify,
  });
  if (!result.success) {
    return roundsJson({ error: result.error }, 400);
  }

  let notified: NoticeCounts | undefined;
  if (result.changeId && notify) {
    try {
      notified = await notifyVisitChange({
        tenantId: auth.ctx.tenantId,
        changeId: result.changeId,
      });
    } catch (err) {
      console.error(
        '[POST /api/rounds/visits/move-remaining] notify',
        err instanceof Error ? err.message : 'failed',
      );
    }
  }

  return roundsJson({
    success: true,
    moved: result.moved,
    changeId: result.changeId,
    ...(notified ? { notified } : {}),
  });
}
