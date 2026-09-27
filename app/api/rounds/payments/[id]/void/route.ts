import { z } from 'zod';
import {
  firstZodError,
  moneyErrorStatus,
  readJsonBody,
  requireRoundsApi,
  roundsJson,
} from '@/lib/api/rounds-request';
import { voidPaymentCore } from '@/lib/payments/money-core';

const voidBodySchema = z.object({
  reason: z.string().trim().max(300).optional().or(z.literal('')),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const paymentId = z.string().uuid().safeParse(id);
  if (!paymentId.success) {
    return roundsJson({ error: 'Invalid payment' }, 400);
  }

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = voidBodySchema.safeParse(json.body);
  if (!parsed.success) {
    return roundsJson({ error: firstZodError(parsed.error) }, 400);
  }

  const result = await voidPaymentCore(auth.ctx.supabase, {
    tenantId: auth.ctx.tenantId,
    paymentId: paymentId.data,
    reason: parsed.data.reason,
    userId: auth.ctx.userId,
  });
  if (!result.success) {
    return roundsJson({ error: result.error }, moneyErrorStatus(result.error));
  }

  return roundsJson({ success: true });
}
