import { firstZodError, readJsonBody, requireRoundsApi, roundsJson } from '@/lib/api/rounds-request';
import { createAdminClient } from '@/lib/supabase/admin';
import { undoHandOver } from '@/lib/team/hand-in';
import { undoHandOverSchema } from '@/lib/validations/team';

/** Un-tick a payment ticked by mistake (owner only; within 14 days). */
export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const parsed = undoHandOverSchema.safeParse(json.body);
  if (!parsed.success) return roundsJson({ error: firstZodError(parsed.error) }, 400);

  const result = await undoHandOver(createAdminClient(), { tenantId: auth.ctx.tenantId, paymentId: parsed.data.paymentId });
  if (!result.ok) return roundsJson({ error: result.error }, 400);
  return roundsJson({ ok: true });
}
