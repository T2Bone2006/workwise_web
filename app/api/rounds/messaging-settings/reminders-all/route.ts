import {
  readJsonBody,
  requireRoundsApi,
  roundsJson,
} from '@/lib/api/rounds-request';
import { turnOnRemindersForAllCore } from '@/lib/messaging/settings-core';

export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const result = await turnOnRemindersForAllCore(auth.ctx.supabase, auth.ctx.tenantId);
  if (!result.success) return roundsJson({ error: result.error }, 400);
  return roundsJson({ success: true, updated: result.updated });
}
