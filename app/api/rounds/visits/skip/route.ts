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
import { sendVisitDoneAfterSkip } from '@/lib/payments/notify';
import { skipVisitWithLog } from '@/lib/rounds/visit-changes';
import { skipVisitSchema } from '@/lib/validations/rounds/visit';

export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = skipVisitSchema.safeParse(json.body);
  if (!parsed.success) {
    return roundsJson({ error: firstZodError(parsed.error) }, 400);
  }

  const notify = parsed.data.notifyCustomer ?? false;
  const actor = await actorForUser(auth.ctx.supabase, auth.ctx.userId);
  const result = await skipVisitWithLog(auth.ctx.supabase, {
    tenantId: auth.ctx.tenantId,
    jobId: parsed.data.jobId,
    reason: parsed.data.reason,
    note: emptyToNull(parsed.data.note),
    actor,
    notifyCustomer: notify,
  });
  if (!result.success) {
    const status =
      result.code === 'already_completed' ? 409 : result.retryable ? 503 : 400;
    return roundsJson(
      { error: result.error, ...(result.code ? { code: result.code } : {}) },
      status,
    );
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
        '[POST /api/rounds/visits/skip] notify',
        err instanceof Error ? err.message : 'failed',
      );
    }
  }

  // Skipping the last service left at a house sends the stop's visit-done message.
  await sendVisitDoneAfterSkip(auth.ctx.supabase, {
    tenantId: auth.ctx.tenantId,
    jobId: parsed.data.jobId,
  });

  return roundsJson({
    success: true,
    alreadySkipped: result.alreadySkipped,
    changeId: result.changeId ?? null,
    ...(notified ? { notified } : {}),
  });
}
