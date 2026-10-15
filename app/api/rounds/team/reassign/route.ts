import { actorForUser, firstZodError, readJsonBody, requireRoundsApi, roundsJson } from '@/lib/api/rounds-request';
import { createAdminClient } from '@/lib/supabase/admin';
import { reassignVisits } from '@/lib/team/assign';
import { reassignVisitsSchema } from '@/lib/validations/rounds/visit';

/** Give specific visits to one person (owner only). */
export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const parsed = reassignVisitsSchema.safeParse(json.body);
  if (!parsed.success) return roundsJson({ error: firstZodError(parsed.error) }, 400);

  const actor = await actorForUser(auth.ctx.supabase, auth.ctx.userId);
  const result = await reassignVisits(createAdminClient(), {
    tenantId: auth.ctx.tenantId,
    jobIds: parsed.data.jobIds,
    toWorkerId: parsed.data.toWorkerId,
    actor,
  });
  if (!result.success) return roundsJson({ error: result.error }, 400);
  return roundsJson({ moved: result.moved, changeId: result.changeId });
}
