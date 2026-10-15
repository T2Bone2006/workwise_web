import { firstZodError, readJsonBody, requireRoundsApi, roundsJson } from '@/lib/api/rounds-request';
import { previewPushBack } from '@/lib/rounds/push-back-core';
import { createAdminClient } from '@/lib/supabase/admin';
import { pushBackSchema } from '@/lib/validations/rounds/visit';

/** What a push back would do, without doing it (owner only). */
export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const parsed = pushBackSchema.safeParse(json.body);
  if (!parsed.success) return roundsJson({ error: firstZodError(parsed.error) }, 400);

  const result = await previewPushBack(createAdminClient(), {
    tenantId: auth.ctx.tenantId,
    workerId: parsed.data.workerId,
    offFrom: parsed.data.offFrom,
    offTo: parsed.data.offTo,
  });
  if (!result.success) return roundsJson({ error: result.error }, 400);
  return roundsJson({
    moves: result.plan.moves.length,
    stuck: result.plan.stuck.length,
    lastDate: result.lastDate,
    firstMoves: result.sample,
  });
}
