import { requireDirectDebitApi, unexpected } from '@/lib/api/direct-debit-request';
import { readJsonBody, roundsJson } from '@/lib/api/rounds-request';
import { directDebitState } from '@/lib/direct-debit/state';
import { refreshVerification } from '@/lib/gocardless/connection';

export const runtime = 'nodejs';

/** "Check again" after GoCardless asked for more details: ask GoCardless now, whatever the 5-minute rule says. */
export async function POST(request: Request) {
  const auth = await requireDirectDebitApi(request, 'act');
  if (!auth.ok) return auth.response;
  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  try {
    const connection = await refreshVerification(auth.ctx.admin, auth.ctx.tenantId, { force: true });
    return roundsJson({ state: directDebitState(connection) });
  } catch (err) {
    return unexpected('POST /api/rounds/direct-debit/refresh', err);
  }
}
