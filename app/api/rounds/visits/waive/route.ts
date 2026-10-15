import {
  firstZodError,
  moneyErrorStatus,
  readJsonBody,
  requireRoundsApi,
  roundsJson,
} from '@/lib/api/rounds-request';
import { setVisitWaivedCore } from '@/lib/payments/money-core';
import { waiveVisitSchema } from '@/lib/validations/payments';

export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = waiveVisitSchema.safeParse(json.body);
  if (!parsed.success) {
    return roundsJson({ error: firstZodError(parsed.error) }, 400);
  }

  const result = await setVisitWaivedCore(auth.ctx.supabase, {
    tenantId: auth.ctx.tenantId,
    jobId: parsed.data.jobId,
    waived: parsed.data.waived,
  });
  if (!result.success) {
    return roundsJson({ error: result.error }, moneyErrorStatus(result.error));
  }

  return roundsJson({ success: true });
}
