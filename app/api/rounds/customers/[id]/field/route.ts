import { z } from 'zod';
import {
  firstZodError,
  readJsonBody,
  requireRoundsApi,
  roundsJson,
} from '@/lib/api/rounds-request';
import { updateCustomerFieldCore } from '@/lib/rounds/customer-field';
import { customerFieldSchema } from '@/lib/validations/rounds/customer-field';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const { id: rawId } = await context.params;
  const id = z.string().uuid().safeParse(rawId);
  if (!id.success) return roundsJson({ error: 'Customer not found' }, 404);

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = customerFieldSchema.safeParse(json.body);
  if (!parsed.success) {
    return roundsJson({ error: firstZodError(parsed.error) }, 400);
  }

  const saved = await updateCustomerFieldCore(auth.ctx.supabase, {
    tenantId: auth.ctx.tenantId,
    customerId: id.data,
    change: parsed.data,
  });
  if (!saved.success) {
    const status = saved.error === 'Customer not found' ? 404 : 400;
    return roundsJson({ error: saved.error }, status);
  }
  return roundsJson({ success: true, value: saved.value });
}
