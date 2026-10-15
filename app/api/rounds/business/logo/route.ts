import { z } from 'zod';
import {
  firstZodError,
  moneyErrorStatus,
  readJsonBody,
  requireRoundsApi,
  roundsJson,
} from '@/lib/api/rounds-request';
import { setCompanyLogoCore } from '@/lib/business/logo';

const logoSchema = z.object({
  path: z.string().nullable(),
});

export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = logoSchema.safeParse(json.body);
  if (!parsed.success) {
    return roundsJson({ error: firstZodError(parsed.error) }, 400);
  }

  const result = await setCompanyLogoCore(
    auth.ctx.supabase,
    auth.ctx.tenantId,
    parsed.data.path,
  );
  if (!result.success) {
    return roundsJson({ error: result.error }, moneyErrorStatus(result.error));
  }

  return roundsJson({ logoUrl: result.logoUrl });
}
