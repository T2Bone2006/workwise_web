import { getTextsStatus } from '@/lib/data/messaging/texts-status';
import { requireRoundsApi, roundsJson } from '@/lib/api/rounds-request';

export async function GET(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  try {
    // Superset of the old usage shape: the phone and the dashboard banner read the same thing.
    const status = await getTextsStatus(auth.ctx.supabase, auth.ctx.tenantId);
    return roundsJson(status);
  } catch (err) {
    console.error('[GET /api/rounds/texts]', err);
    return roundsJson({ error: 'Could not load text usage' }, 500);
  }
}
