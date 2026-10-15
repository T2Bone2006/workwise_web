import { actorForUser, firstZodError, readJsonBody, requireRoundsApi, roundsJson } from '@/lib/api/rounds-request';
import { createAdminClient } from '@/lib/supabase/admin';
import { giveRoundOnDay } from '@/lib/team/assign';
import { giveRoundSchema } from '@/lib/validations/rounds/visit';

/** Give one person's round (or one named round) on one day to someone else (owner only). */
export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const parsed = giveRoundSchema.safeParse(json.body);
  if (!parsed.success) return roundsJson({ error: firstZodError(parsed.error) }, 400);

  const actor = await actorForUser(auth.ctx.supabase, auth.ctx.userId);
  const result = await giveRoundOnDay(createAdminClient(), {
    tenantId: auth.ctx.tenantId,
    date: parsed.data.date,
    fromWorkerId: parsed.data.fromWorkerId,
    toWorkerId: parsed.data.toWorkerId,
    roundId: parsed.data.roundId ?? null,
    actor,
  });
  if (!result.success) return roundsJson({ error: result.error }, 400);
  return roundsJson({ moved: result.moved, changeId: result.changeId });
}
