import {
  firstZodError,
  readJsonBody,
  requireRoundsApi,
  roundsJson,
} from '@/lib/api/rounds-request';
import { requestChangeNotice } from '@/lib/messaging/visit-change-notices';
import { todayInLondon } from '@/lib/rounds/dates';
import { tellChangeSchema } from '@/lib/validations/rounds/visit';

export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = tellChangeSchema.safeParse(json.body);
  if (!parsed.success) {
    return roundsJson({ error: firstZodError(parsed.error) }, 400);
  }

  try {
    const result = await requestChangeNotice(auth.ctx.supabase, {
      tenantId: auth.ctx.tenantId,
      changeId: parsed.data.changeId,
      today: todayInLondon(),
    });
    if (!result.success) {
      return roundsJson({ error: result.error }, 400);
    }
    return roundsJson({
      success: true,
      alreadyTold: result.alreadyTold,
      notified: result.notified,
    });
  } catch (err) {
    console.error(
      '[POST /api/rounds/visit-changes/tell]',
      err instanceof Error ? err.message : 'failed',
    );
    return roundsJson({ error: 'Could not tell them. Try again.' }, 400);
  }
}
