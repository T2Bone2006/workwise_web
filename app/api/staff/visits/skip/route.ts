import { emptyToNull, firstZodError, readJsonBody } from '@/lib/api/rounds-request';
import { NOT_YOURS, ownsVisit, requireStaffApi, staffJson } from '@/lib/api/staff-request';
import { sendVisitDoneAfterSkip } from '@/lib/payments/notify';
import { skipVisitWithLog } from '@/lib/rounds/visit-changes';
import { skipVisitSchema } from '@/lib/validations/rounds/visit';

/** Skip, from a member of staff's phone. Only their own visit, and it never tells the customer (the owner decides). */
export async function POST(request: Request) {
  const auth = await requireStaffApi(request);
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const parsed = skipVisitSchema.safeParse(json.body);
  if (!parsed.success) return staffJson({ error: firstZodError(parsed.error) }, 400);

  if (!(await ownsVisit(ctx, parsed.data.jobId))) return staffJson({ error: NOT_YOURS }, 403);

  const result = await skipVisitWithLog(ctx.db, {
    tenantId: ctx.tenantId,
    jobId: parsed.data.jobId,
    reason: parsed.data.reason,
    note: emptyToNull(parsed.data.note),
    actor: { userId: ctx.userId, workerId: ctx.workerId },
    notifyCustomer: false,
  });
  if (!result.success) {
    const status = result.code === 'already_completed' ? 409 : result.retryable ? 503 : 400;
    return staffJson({ error: result.error, ...(result.code ? { code: result.code } : {}) }, status);
  }

  // Skipping the last service left at a house sends the stop's visit-done message, as it does for the owner.
  await sendVisitDoneAfterSkip(ctx.db, { tenantId: ctx.tenantId, jobId: parsed.data.jobId });

  return staffJson({ success: true, alreadySkipped: result.alreadySkipped, changeId: result.changeId ?? null });
}
