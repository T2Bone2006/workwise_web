import { firstZodError, readJsonBody, requireRoundsApi, roundsJson } from '@/lib/api/rounds-request';
import { createAdminClient } from '@/lib/supabase/admin';
import { clearWorkerCash, markHandedOver } from '@/lib/team/hand-in';
import { handOverSchema } from '@/lib/validations/team';

/** Tick payments as handed over: some of them, or everything one person holds (owner only). */
export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const parsed = handOverSchema.safeParse(json.body);
  if (!parsed.success) return roundsJson({ error: firstZodError(parsed.error) }, 400);

  const db = createAdminClient();
  const result = parsed.data.workerId
    ? await clearWorkerCash(db, { tenantId: auth.ctx.tenantId, workerId: parsed.data.workerId, userId: auth.ctx.userId, handedOverOn: parsed.data.handedOverOn })
    : await markHandedOver(db, { tenantId: auth.ctx.tenantId, paymentIds: parsed.data.paymentIds ?? [], userId: auth.ctx.userId, handedOverOn: parsed.data.handedOverOn });
  if (!result.ok) return roundsJson({ error: result.error }, 400);
  return roundsJson({ changed: result.changed });
}
