import { NextResponse } from 'next/server';
import { emptyToNull, firstZodError, readJsonBody } from '@/lib/api/rounds-request';
import { NOT_YOURS, ownsVisit, requireStaffApi } from '@/lib/api/staff-request';
import { completeVisitCore } from '@/lib/rounds/visit-transitions';
import { completeVisitSchema } from '@/lib/validations/rounds/visit';

/**
 * Done, from a member of staff's phone. Only their own visit. Cash or a cheque is saved as HELD by them until the owner
 * ticks it handed over; the customer is treated as paid at once. They cannot send invoices (sendInvoice is ignored).
 */
export async function POST(request: Request) {
  const auth = await requireStaffApi(request);
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const parsed = completeVisitSchema.safeParse(json.body);
  if (!parsed.success) return NextResponse.json({ error: firstZodError(parsed.error) }, { status: 400 });

  if (!(await ownsVisit(ctx, parsed.data.jobId))) {
    return NextResponse.json({ error: NOT_YOURS }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }

  const result = await completeVisitCore(ctx.db, {
    tenantId: ctx.tenantId,
    jobId: parsed.data.jobId,
    finalAmount: parsed.data.finalAmount,
    notes: emptyToNull(parsed.data.notes),
    actor: { userId: ctx.userId, workerId: ctx.workerId },
    payment: parsed.data.payment,
    sendInvoice: undefined,
    clientMutationId: parsed.data.clientMutationId,
    completedAt: parsed.data.completedAt,
    collectedBy: { workerId: ctx.workerId, name: ctx.name },
  });
  if (!result.success) {
    // 503 = temporary: the phone keeps the queued Done and retries by itself.
    return NextResponse.json({ error: result.error }, { status: result.retryable ? 503 : 400 });
  }
  return NextResponse.json({
    success: true,
    alreadyCompleted: result.alreadyCompleted,
    skippedElsewhere: result.skippedElsewhere,
    paymentId: result.paymentId,
  });
}
