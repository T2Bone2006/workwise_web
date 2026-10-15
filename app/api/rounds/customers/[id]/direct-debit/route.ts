import {
  parseUuidParam,
  requireDirectDebitApi,
  unexpected,
} from '@/lib/api/direct-debit-request';
import { roundsJson } from '@/lib/api/rounds-request';
import { getCustomerDirectDebit } from '@/lib/data/direct-debit/customer';
import { getDirectDebitState } from '@/lib/direct-debit/state';

export const runtime = 'nodejs';

/** A customer's Direct Debit picture + the business's state (workers may read it). */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireDirectDebitApi(request, 'read');
  if (!auth.ok) return auth.response;

  const id = parseUuidParam((await context.params).id);
  if (!id.ok) return id.response;
  const { admin, tenantId } = auth.ctx;

  try {
    // The customer must belong to the token's tenant (a worker's row-level access may be narrower).
    const { data: customer, error } = await admin
      .from('customers')
      .select('id')
      .eq('id', id.id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error || !customer) return roundsJson({ error: 'Customer not found.' }, 404);

    const [picture, businessState] = await Promise.all([
      getCustomerDirectDebit(admin, tenantId, id.id),
      getDirectDebitState(admin, tenantId),
    ]);
    return roundsJson({ ...picture, businessState });
  } catch (err) {
    return unexpected('GET /api/rounds/customers/[id]/direct-debit', err);
  }
}
