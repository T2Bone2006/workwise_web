import { firstZodError, readJsonBody, requireRoundsApi, roundsJson } from '@/lib/api/rounds-request';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordCrewDay } from '@/lib/team/crew-day';
import { startDaySchema } from '@/lib/validations/team';

/** Start day on the OWNER's phone: records the helpers who are with them today (the owner is not paid through the app). */
export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const parsed = startDaySchema.safeParse(json.body);
  if (!parsed.success) return roundsJson({ error: firstZodError(parsed.error) }, 400);

  const result = await recordCrewDay(createAdminClient(), {
    tenantId: auth.ctx.tenantId,
    date: parsed.data.date,
    leadPersonId: null,
    helperIds: parsed.data.helperIds,
  });
  if (!result.ok) return roundsJson({ error: result.error }, 400);
  return roundsJson({ recorded: result.recorded, changed: result.changed });
}
