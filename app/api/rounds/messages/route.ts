import { requireRoundsApi, roundsJson } from '@/lib/api/rounds-request';
import {
  getNeedsAttentionCount,
  getThreads,
} from '@/lib/data/messaging/threads';

export async function GET(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const filterParam = new URL(request.url).searchParams.get('filter');
  const filter = filterParam === 'all' ? 'all' : 'attention';

  const [threads, needsAttention] = await Promise.all([
    getThreads(auth.ctx.supabase, auth.ctx.tenantId, { filter }),
    getNeedsAttentionCount(auth.ctx.supabase, auth.ctx.tenantId),
  ]);

  return roundsJson({ threads, needsAttention });
}
