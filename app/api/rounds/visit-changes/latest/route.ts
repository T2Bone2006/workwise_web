import { requireRoundsApi, roundsJson } from '@/lib/api/rounds-request';
import { isValidYmd } from '@/lib/rounds/dates';
import { latestUndoableChange } from '@/lib/rounds/visit-changes';

export async function GET(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const date = new URL(request.url).searchParams.get('date');
  if (date != null && date !== '' && !isValidYmd(date)) {
    return roundsJson({ error: 'Invalid date' }, 400);
  }

  const change = await latestUndoableChange(
    auth.ctx.supabase,
    auth.ctx.tenantId,
    date != null && date !== '' && isValidYmd(date) ? { date } : undefined,
  );
  return roundsJson({ change });
}
