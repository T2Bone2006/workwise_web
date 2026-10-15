import { requireRoundsApi, roundsJson } from '@/lib/api/rounds-request';
import { getThread } from '@/lib/data/messaging/threads';
import { markThreadRead } from '@/lib/messaging/replies';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(
  request: Request,
  context: { params: Promise<{ threadId: string }> },
) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const { threadId } = await context.params;
  const detail = await getThread(auth.ctx.supabase, auth.ctx.tenantId, threadId);
  if (!detail) {
    return roundsJson({ error: 'Conversation not found' }, 404);
  }

  try {
    await markThreadRead(createAdminClient(), auth.ctx.tenantId, threadId);
  } catch (err) {
    console.error(
      '[GET /api/rounds/messages/:threadId]',
      err instanceof Error ? err.message : 'failed',
    );
    return roundsJson({ error: 'Could not mark the conversation read' }, 500);
  }

  return roundsJson({
    ...detail,
    thread: { ...detail.thread, unread: 0 },
  });
}
