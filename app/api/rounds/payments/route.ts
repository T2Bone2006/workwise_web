import {
  firstZodError,
  moneyErrorStatus,
  readJsonBody,
  requireRoundsApi,
  roundsJson,
} from '@/lib/api/rounds-request';
import { recordPaymentCore } from '@/lib/payments/money-core';
import { afterManualPayment } from '@/lib/payments/notify';
import { recordPaymentSchema } from '@/lib/validations/payments';

export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = recordPaymentSchema.safeParse(json.body);
  if (!parsed.success) {
    return roundsJson({ error: firstZodError(parsed.error) }, 400);
  }

  const result = await recordPaymentCore(auth.ctx.supabase, {
    tenantId: auth.ctx.tenantId,
    customerId: parsed.data.customerId,
    amount: parsed.data.amount,
    method: parsed.data.method,
    receivedAt: parsed.data.receivedAt,
    note: parsed.data.note,
    appliesToJobId: parsed.data.appliesToJobId,
    invoiceId: parsed.data.invoiceId,
    clientMutationId: parsed.data.clientMutationId,
    userId: auth.ctx.userId,
  });
  if (!result.success) {
    return roundsJson({ error: result.error }, moneyErrorStatus(result.error));
  }

  await afterManualPayment(auth.ctx.supabase, {
    tenantId: auth.ctx.tenantId,
    paymentId: result.paymentId,
    duplicate: result.duplicate,
  });

  return roundsJson({ paymentId: result.paymentId, duplicate: result.duplicate });
}
