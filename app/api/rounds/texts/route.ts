import { getTextUsage } from '@/lib/data/messaging/texts';
import { requireRoundsApi, roundsJson } from '@/lib/api/rounds-request';

export async function GET(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  try {
    const usage = await getTextUsage(auth.ctx.supabase, auth.ctx.tenantId);
    return roundsJson(usage);
  } catch (err) {
    console.error('[GET /api/rounds/texts]', err);
    return roundsJson({ error: 'Could not load text usage' }, 500);
  }
}
