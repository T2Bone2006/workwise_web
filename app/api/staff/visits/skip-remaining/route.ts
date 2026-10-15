import { firstZodError, readJsonBody } from '@/lib/api/rounds-request';
import { requireStaffApi, staffJson } from '@/lib/api/staff-request';
import { skipRemainingCore } from '@/lib/rounds/visit-changes';
import { skipRemainingSchema } from '@/lib/validations/rounds/visit';

/** Skip remaining, from a member of staff's phone: only their own leftover stops, and customers are never texted. */
export async function POST(request: Request) {
  const auth = await requireStaffApi(request);
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const parsed = skipRemainingSchema.safeParse(json.body);
  if (!parsed.success) return staffJson({ error: firstZodError(parsed.error) }, 400);

  const result = await skipRemainingCore(ctx.db, {
    tenantId: ctx.tenantId,
    date: parsed.data.date,
    actor: { userId: ctx.userId, workerId: ctx.workerId },
    notifyCustomers: false,
    workerId: ctx.workerId,
  });
  if (!result.success) return staffJson({ error: result.error }, 400);
  return staffJson({ success: true, skipped: result.skipped, changeId: result.changeId });
}
