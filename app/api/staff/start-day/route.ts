import { firstZodError, readJsonBody } from '@/lib/api/rounds-request';
import { requireStaffApi, staffJson } from '@/lib/api/staff-request';
import { recordCrewDay } from '@/lib/team/crew-day';
import { startDaySchema } from '@/lib/validations/team';

/** Start day, from a member of staff's phone: records them and the helpers who are with them today. Safe to repeat. */
export async function POST(request: Request) {
  const auth = await requireStaffApi(request);
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const parsed = startDaySchema.safeParse(json.body);
  if (!parsed.success) return staffJson({ error: firstZodError(parsed.error) }, 400);

  const result = await recordCrewDay(ctx.db, {
    tenantId: ctx.tenantId,
    date: parsed.data.date,
    leadPersonId: ctx.personId,
    helperIds: parsed.data.helperIds,
  });
  if (!result.ok) return staffJson({ error: result.error }, 400);
  return staffJson({ recorded: result.recorded, changed: result.changed });
}
