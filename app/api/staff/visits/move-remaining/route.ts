import { emptyToNull, firstZodError, readJsonBody } from '@/lib/api/rounds-request';
import { requireStaffApi, staffJson } from '@/lib/api/staff-request';
import { moveRemainingWithLog } from '@/lib/rounds/visit-changes';
import { moveRemainingSchema } from '@/lib/validations/rounds/visit';

/**
 * Move remaining, from a member of staff's phone: only THEIR leftover stops on that day, and customers are never
 * texted (D7). The change is logged with notify off, so the owner sees the "Not told" tag and decides.
 */
export async function POST(request: Request) {
  const auth = await requireStaffApi(request);
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const parsed = moveRemainingSchema.safeParse(json.body);
  if (!parsed.success) return staffJson({ error: firstZodError(parsed.error) }, 400);

  const result = await moveRemainingWithLog(ctx.db, {
    tenantId: ctx.tenantId,
    fromDate: parsed.data.fromDate,
    toDate: parsed.data.toDate,
    scheduledTime: emptyToNull(parsed.data.scheduledTime),
    actor: { userId: ctx.userId, workerId: ctx.workerId },
    notifyCustomers: false,
    workerId: ctx.workerId,
  });
  if (!result.success) return staffJson({ error: result.error }, 400);
  return staffJson({ success: true, moved: result.moved, changeId: result.changeId });
}
