import { z } from 'zod';
import { readJsonBody, requireRoundsApi, roundsJson } from '@/lib/api/rounds-request';
import { getNotDelivered } from '@/lib/data/messaging/not-delivered';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;
  try {
    return roundsJson(await getNotDelivered(auth.ctx.supabase, auth.ctx.tenantId));
  } catch (err) {
    console.error('[GET /api/rounds/texts/not-delivered]', err);
    return roundsJson({ error: 'Could not load the list' }, 500);
  }
}

/** "Mark sorted": hide one customer's dropped message from the list. */
export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = z.object({ messageId: z.string().uuid() }).safeParse(body.body);
  if (!parsed.success) return roundsJson({ error: 'Unknown message' }, 400);

  const { error } = await createAdminClient()
    .from('messages')
    .update({ handled_at: new Date().toISOString(), handled_action: 'dismissed' })
    .eq('id', parsed.data.messageId)
    .eq('tenant_id', auth.ctx.tenantId)
    .eq('status', 'skipped');
  if (error) return roundsJson({ error: 'Could not update' }, 500);
  return roundsJson({ ok: true });
}
