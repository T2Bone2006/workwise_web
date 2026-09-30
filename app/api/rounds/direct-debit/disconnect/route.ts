import { requireDirectDebitApi, unexpected } from '@/lib/api/direct-debit-request';
import { readJsonBody, roundsJson } from '@/lib/api/rounds-request';
import { disconnectGoCardless } from '@/lib/gocardless/oauth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const auth = await requireDirectDebitApi(request, 'act');
  if (!auth.ok) return auth.response;
  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  try {
    await disconnectGoCardless(auth.ctx.admin, { tenantId: auth.ctx.tenantId });
    return roundsJson({ ok: true });
  } catch (err) {
    return unexpected('POST /api/rounds/direct-debit/disconnect', err);
  }
}
