import { actorForUser, firstZodError, readJsonBody, requireRoundsApi, roundsJson } from '@/lib/api/rounds-request';
import { notifyVisitChange, type NoticeCounts } from '@/lib/messaging/visit-change-notices';
import { pushBackWithLog } from '@/lib/rounds/push-back-core';
import { createAdminClient } from '@/lib/supabase/admin';
import { pushBackSchema } from '@/lib/validations/rounds/visit';

/** Slide a person's open visits along their working days while they are off (owner only). Texts customers only if asked. */
export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const parsed = pushBackSchema.safeParse(json.body);
  if (!parsed.success) return roundsJson({ error: firstZodError(parsed.error) }, 400);

  const notify = parsed.data.notifyCustomers ?? false;
  const actor = await actorForUser(auth.ctx.supabase, auth.ctx.userId);
  const result = await pushBackWithLog(createAdminClient(), {
    tenantId: auth.ctx.tenantId,
    workerId: parsed.data.workerId,
    offFrom: parsed.data.offFrom,
    offTo: parsed.data.offTo,
    actor,
    notifyCustomers: notify,
  });
  if (!result.success) return roundsJson({ error: result.error }, 400);

  let notified: NoticeCounts | undefined;
  if (result.changeId && notify) {
    try {
      notified = await notifyVisitChange({ tenantId: auth.ctx.tenantId, changeId: result.changeId });
    } catch (err) {
      console.error('[team/push-back] notify', err instanceof Error ? err.name : 'error');
    }
  }
  return roundsJson({ moved: result.moved, stuck: result.stuck, changeId: result.changeId, notified });
}
