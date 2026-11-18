import { requireRoundsApi, roundsJson } from '@/lib/api/rounds-request';
import { dismissAutoTopUpPrompt } from '@/lib/messaging/auto-top-up';
import { createAdminClient } from '@/lib/supabase/admin';

/** "Not now" on the auto top-up prompt. Counts at most twice. */
export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;
  await dismissAutoTopUpPrompt(createAdminClient(), auth.ctx.tenantId);
  return roundsJson({ ok: true });
}
