import { z } from 'zod';
import { requireRoundsApi, roundsJson } from '@/lib/api/rounds-request';
import { getCustomerRecentMessages } from '@/lib/data/messaging/threads';

export async function GET(
  request: Request,
  context: { params: Promise<{ customerId: string }> },
) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const { customerId: rawId } = await context.params;
  const customerId = z.string().uuid().safeParse(rawId);
  if (!customerId.success) {
    return roundsJson({ error: 'Invalid customer' }, 400);
  }

  const { data: customer, error } = await auth.ctx.supabase
    .from('customers')
    .select('id')
    .eq('id', customerId.data)
    .eq('tenant_id', auth.ctx.tenantId)
    .maybeSingle();
  if (error) return roundsJson({ error: error.message }, 400);
  if (!customer) return roundsJson({ error: 'Customer not found' }, 404);

  const recent = await getCustomerRecentMessages(
    auth.ctx.supabase,
    auth.ctx.tenantId,
    customerId.data,
    20,
  );
  return roundsJson(recent);
}
