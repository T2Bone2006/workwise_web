import { firstZodError, readJsonBody } from '@/lib/api/rounds-request';
import { requireStaffApi, staffJson } from '@/lib/api/staff-request';
import { recordStaffPayment } from '@/lib/team/staff-cash';
import { staffPaymentSchema } from '@/lib/validations/team';

/** Record cash or a cheque taken from one of their own customers. Held by them until the owner ticks it handed over. */
export async function POST(request: Request) {
  const auth = await requireStaffApi(request);
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const parsed = staffPaymentSchema.safeParse(json.body);
  if (!parsed.success) return staffJson({ error: firstZodError(parsed.error) }, 400);

  const result = await recordStaffPayment(ctx.db, {
    tenantId: ctx.tenantId,
    workerId: ctx.workerId,
    name: ctx.name,
    userId: ctx.userId,
    ...parsed.data,
  });
  if (!result.success) return staffJson({ error: result.error }, result.retryable ? 503 : 400);
  return staffJson({ paymentId: result.paymentId, duplicate: result.duplicate });
}
