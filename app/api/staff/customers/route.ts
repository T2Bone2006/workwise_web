import { readJsonBody } from '@/lib/api/rounds-request';
import { requireStaffApi, staffJson } from '@/lib/api/staff-request';
import { createDoorstepCustomerCore } from '@/lib/rounds/doorstep-customer';

/**
 * A member of staff adds a customer they meet on the round. The customer is marked "added by" them for the owner to
 * check, and the regular service and its first visits are theirs. This is the only customer write staff get: they
 * cannot edit a customer, end a service or change a price afterwards.
 */
export async function POST(request: Request) {
  const auth = await requireStaffApi(request);
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const result = await createDoorstepCustomerCore(ctx.db, {
    tenantId: ctx.tenantId,
    body: json.body,
    addedByWorkerId: ctx.workerId,
    assignWorkerId: ctx.workerId,
  });
  if (!result.ok) return staffJson({ error: result.error }, result.status);
  return staffJson({ customerId: result.customerId, agreementId: result.agreementId });
}
