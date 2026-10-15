import {
  actorForUser,
  firstZodError,
  readJsonBody,
  requireRoundsApi,
  roundsJson,
} from '@/lib/api/rounds-request';
import { actOnReplyCore } from '@/lib/messaging/replies';
import { actOnReplySchema } from '@/lib/validations/messaging';

export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = actOnReplySchema.safeParse(json.body);
  if (!parsed.success) {
    return roundsJson({ error: firstZodError(parsed.error) }, 400);
  }

  const actor = await actorForUser(auth.ctx.supabase, auth.ctx.userId);
  const result = await actOnReplyCore(auth.ctx.supabase, {
    tenantId: auth.ctx.tenantId,
    actor,
    threadId: parsed.data.threadId,
    action: parsed.data.action,
    toDate: parsed.data.toDate,
    letThemKnow: parsed.data.letThemKnow,
  });
  if (!result.success) {
    const status = result.error === 'Conversation not found' ? 404 : 400;
    return roundsJson(
      {
        error: result.error,
        ...(result.code ? { code: result.code } : {}),
      },
      status,
    );
  }

  return roundsJson({
    success: true,
    changeId: result.changeId,
    acknowledged: result.acknowledged,
  });
}
