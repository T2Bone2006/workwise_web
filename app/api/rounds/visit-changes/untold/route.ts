import { requireRoundsApi, roundsJson } from '@/lib/api/rounds-request';
import { todayInLondon } from '@/lib/rounds/dates';
import { listUntoldMoves } from '@/lib/rounds/visit-changes';

export async function GET(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const moves = await listUntoldMoves(auth.ctx.supabase, auth.ctx.tenantId, {
    today: todayInLondon(),
  });
  if (!moves) return roundsJson({ error: 'Could not load the moves. Try again.' }, 400);
  return roundsJson({ moves });
}
