import { parseUuidParam, unexpected } from '@/lib/api/direct-debit-request';
import { requireExpensesApi } from '@/lib/api/expenses-request';
import { roundsJson } from '@/lib/api/rounds-request';
import { receiptSignedUrl } from '@/lib/expenses/expenses-core';

export const runtime = 'nodejs';

/** A 5-minute link to this expense's receipt photo. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireExpensesApi(request);
  if (!auth.ok) return auth.response;
  const id = parseUuidParam((await context.params).id);
  if (!id.ok) return id.response;

  try {
    const url = await receiptSignedUrl(auth.ctx.admin, {
      tenantId: auth.ctx.tenantId,
      expenseId: id.id,
    });
    if (!url) return roundsJson({ error: "There's no photo for this expense." }, 404);
    return roundsJson({ url });
  } catch (err) {
    return unexpected('GET /api/rounds/expenses/[id]/receipt', err);
  }
}
