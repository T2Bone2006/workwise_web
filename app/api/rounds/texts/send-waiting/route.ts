import { requireRoundsApi, roundsJson } from '@/lib/api/rounds-request';
import { releaseWaitingForTenant } from '@/lib/messaging/release-waiting';
import { createAdminClient } from '@/lib/supabase/admin';

/** The "Send waiting messages" button: send everything that waited for texts, oldest first, as far as texts go. */
export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  try {
    const admin = createAdminClient();
    const { count, error } = await admin
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', auth.ctx.tenantId)
      .eq('status', 'waiting_texts');
    if (error) return roundsJson({ error: 'Could not check waiting messages' }, 500);
    if (!count) return roundsJson({ error: 'Nothing is waiting' }, 409);

    const result = await releaseWaitingForTenant(admin, auth.ctx.tenantId);
    return roundsJson({ ...result, sent: result.released });
  } catch (err) {
    console.error('[POST /api/rounds/texts/send-waiting]', err);
    return roundsJson({ error: 'Could not send waiting messages' }, 500);
  }
}
