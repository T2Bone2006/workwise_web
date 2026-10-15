import {
  actorForUser,
  firstZodError,
  readJsonBody,
  requireRoundsApi,
  roundsJson,
} from '@/lib/api/rounds-request';
import { todayInLondon } from '@/lib/rounds/dates';
import { moveStopToDayWithLog } from '@/lib/rounds/visit-changes';
import { moveStopSchema } from '@/lib/validations/rounds/visit';

export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = moveStopSchema.safeParse(json.body);
  if (!parsed.success) {
    return roundsJson({ error: firstZodError(parsed.error) }, 400);
  }

  const actor = await actorForUser(auth.ctx.supabase, auth.ctx.userId);
  const result = await moveStopToDayWithLog(auth.ctx.supabase, {
    tenantId: auth.ctx.tenantId,
    jobIds: parsed.data.jobIds,
    toDate: parsed.data.toDate,
    orderedJobIds: parsed.data.orderedJobIds,
    today: todayInLondon(),
    actor,
  });
  if (!result.success) {
    return roundsJson({ error: result.error }, 400);
  }

  return roundsJson({
    success: true,
    moved: result.moved,
    changeId: result.changeId,
    orderSaved: result.orderSaved,
  });
}
