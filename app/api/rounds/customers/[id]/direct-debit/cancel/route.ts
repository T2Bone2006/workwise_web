import {
  coreError,
  parseUuidParam,
  requireDirectDebitApi,
  unexpected,
} from '@/lib/api/direct-debit-request';
import { readJsonBody, roundsJson } from '@/lib/api/rounds-request';
import { cancelDirectDebit } from '@/lib/direct-debit/after-collection';

export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireDirectDebitApi(request, 'act');
  if (!auth.ok) return auth.response;

  const id = parseUuidParam((await context.params).id);
  if (!id.ok) return id.response;
  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  try {
    const result = await cancelDirectDebit(auth.ctx.admin, {
      tenantId: auth.ctx.tenantId,
      userId: auth.ctx.userId,
      customerId: id.id,
    });
    if (!result.ok) return coreError(result.error);
    return roundsJson({ stillCollecting: result.stillCollecting });
  } catch (err) {
    return unexpected('POST /api/rounds/customers/[id]/direct-debit/cancel', err);
  }
}
