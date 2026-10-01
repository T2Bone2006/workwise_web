import {
  actorForUser,
  firstZodError,
  readJsonBody,
  requireRoundsApi,
  roundsJson,
} from '@/lib/api/rounds-request';
import {
  notifyVisitChange,
  type NoticeCounts,
} from '@/lib/messaging/visit-change-notices';
import { todayInLondon } from '@/lib/rounds/dates';
import { swapDaysWithLog } from '@/lib/rounds/visit-changes';
import { swapDaysSchema } from '@/lib/validations/rounds/visit';

export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = swapDaysSchema.safeParse(json.body);
  if (!parsed.success) {
    return roundsJson({ error: firstZodError(parsed.error) }, 400);
  }

  const notify = parsed.data.notifyCustomers ?? false;
  const actor = await actorForUser(auth.ctx.supabase, auth.ctx.userId);
  const result = await swapDaysWithLog(auth.ctx.supabase, {
    tenantId: auth.ctx.tenantId,
    dayA: parsed.data.dayA,
    dayB: parsed.data.dayB,
    clientKey: parsed.data.clientKey,
    notifyCustomers: notify,
    today: todayInLondon(),
    actor,
  });
  if (!result.success) {
    return roundsJson(
      { error: result.error, ...(result.changeId ? { changeId: result.changeId } : {}) },
      400,
    );
  }

  let notified: NoticeCounts | undefined;
  if (notify && !result.alreadyDone) {
    try {
      notified = await notifyVisitChange({
        tenantId: auth.ctx.tenantId,
        changeId: result.changeId,
      });
    } catch (err) {
      console.error(
        '[POST /api/rounds/visits/swap-days] notify',
        err instanceof Error ? err.message : 'failed',
      );
    }
  }

  return roundsJson({
    success: true,
    changeId: result.changeId,
    movedToB: result.movedToB,
    movedToA: result.movedToA,
    orderSaved: result.orderSaved,
    alreadyDone: result.alreadyDone,
    ...(notified ? { notified } : {}),
  });
}
