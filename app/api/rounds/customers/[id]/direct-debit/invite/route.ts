import {
  coreError,
  parseUuidParam,
  requireDirectDebitApi,
  unexpected,
} from '@/lib/api/direct-debit-request';
import { readJsonBody, roundsJson } from '@/lib/api/rounds-request';
import { getDirectDebitState } from '@/lib/direct-debit/state';
import { sendDirectDebitInvite } from '@/lib/direct-debit/setup';

export const runtime = 'nodejs';

/** Emails or texts the customer their Direct Debit link. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireDirectDebitApi(request, 'act');
  if (!auth.ok) return auth.response;

  const id = parseUuidParam((await context.params).id);
  if (!id.ok) return id.response;
  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const { admin, tenantId } = auth.ctx;

  try {
    if ((await getDirectDebitState(admin, tenantId)) !== 'on') {
      return roundsJson({ error: 'Connect GoCardless first.' }, 400);
    }
    const result = await sendDirectDebitInvite(admin, { tenantId, customerId: id.id });
    if (!result.ok) return coreError(result.error);
    return roundsJson({ channel: result.channel });
  } catch (err) {
    return unexpected('POST /api/rounds/customers/[id]/direct-debit/invite', err);
  }
}
