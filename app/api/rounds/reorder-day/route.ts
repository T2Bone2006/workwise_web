import {
  firstZodError,
  readJsonBody,
  requireRoundsApi,
  roundsJson,
} from '@/lib/api/rounds-request';
import { reorderDayCore } from '@/lib/rounds/visit-transitions';
import { reorderDaySchema } from '@/lib/validations/rounds/visit';

export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = reorderDaySchema.safeParse(json.body);
  if (!parsed.success) {
    return roundsJson({ error: firstZodError(parsed.error) }, 400);
  }

  const result = await reorderDayCore(auth.ctx.supabase, {
    tenantId: auth.ctx.tenantId,
    date: parsed.data.date,
    orderedJobIds: parsed.data.jobIds,
  });
  if (!result.success) {
    return roundsJson({ error: result.error }, 400);
  }

  return roundsJson({ success: true });
}
