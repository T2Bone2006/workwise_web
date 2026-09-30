import {
  coreError,
  parseUuidParam,
  requireDirectDebitApi,
  unexpected,
} from '@/lib/api/direct-debit-request';
import { roundsJson } from '@/lib/api/rounds-request';
import { getDirectDebitState } from '@/lib/direct-debit/state';
import { getDirectDebitLink } from '@/lib/direct-debit/setup';

export const runtime = 'nodejs';

/** The link to share by hand, plus the ready-made message. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireDirectDebitApi(request, 'read');
  if (!auth.ok) return auth.response;

  const id = parseUuidParam((await context.params).id);
  if (!id.ok) return id.response;
  const { admin, tenantId } = auth.ctx;

  try {
    if ((await getDirectDebitState(admin, tenantId)) !== 'on') {
      return roundsJson({ error: 'Connect GoCardless first.' }, 400);
    }
    const result = await getDirectDebitLink(admin, { tenantId, customerId: id.id });
    if (!result.ok) return coreError(result.error);
    return roundsJson({ url: result.url, shareText: result.shareText });
  } catch (err) {
    return unexpected('GET /api/rounds/customers/[id]/direct-debit/link', err);
  }
}
