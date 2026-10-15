import { z } from 'zod';
import { requireStaffApi, staffJson } from '@/lib/api/staff-request';
import { getStaffCustomer } from '@/lib/team/staff-cash';

/** A customer on one of this member of staff's visits: name, phone, address, access notes and what they owe. 404 otherwise. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffApi(request);
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  const id = z.string().uuid().safeParse((await context.params).id);
  if (!id.success) return staffJson({ error: 'Not found.' }, 404);
  const customer = await getStaffCustomer(ctx.db, { tenantId: ctx.tenantId, workerId: ctx.workerId, customerId: id.data });
  if (!customer) return staffJson({ error: 'Not found.' }, 404);
  return staffJson(customer);
}
