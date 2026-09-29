import { z } from 'zod';
import {
  firstZodError,
  readJsonBody,
  requireRoundsApi,
  roundsJson,
} from '@/lib/api/rounds-request';
import { updateCustomerMessagingCore } from '@/lib/messaging/settings-core';
import { customerMessagingSchema } from '@/lib/validations/messaging';

const customerMessagingPatchSchema = customerMessagingSchema.omit({ customerId: true });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const { id: rawId } = await context.params;
  const id = z.string().uuid().safeParse(rawId);
  if (!id.success) return roundsJson({ error: 'Invalid customer' }, 400);

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = customerMessagingPatchSchema.safeParse(json.body);
  if (!parsed.success) {
    return roundsJson({ error: firstZodError(parsed.error) }, 400);
  }

  const { data: customer, error } = await auth.ctx.supabase
    .from('customers')
    .select('id')
    .eq('id', id.data)
    .eq('tenant_id', auth.ctx.tenantId)
    .maybeSingle();
  if (error) return roundsJson({ error: error.message }, 400);
  if (!customer) return roundsJson({ error: 'Customer not found' }, 404);

  const saved = await updateCustomerMessagingCore(auth.ctx.supabase, auth.ctx.tenantId, {
    ...parsed.data,
    customerId: id.data,
  });
  if (!saved.success) return roundsJson({ error: saved.error }, 400);
  return roundsJson({ success: true });
}
