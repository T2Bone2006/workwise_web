import { requireDirectDebitApi, unexpected } from '@/lib/api/direct-debit-request';
import { roundsJson } from '@/lib/api/rounds-request';
import { directDebitState } from '@/lib/direct-debit/state';
import { goCardlessConfig, isGoCardlessConfigured } from '@/lib/gocardless/config';
import { refreshVerification } from '@/lib/gocardless/connection';

export const runtime = 'nodejs';

/** The business's Direct Debit state for the phone (workers may read it). */
export async function GET(request: Request) {
  const auth = await requireDirectDebitApi(request, 'read');
  if (!auth.ok) return auth.response;
  const { admin, tenantId } = auth.ctx;

  try {
    // The 5-minute rule: a stored answer younger than that is used as it is.
    const connection = await refreshVerification(admin, tenantId);
    const state = directDebitState(connection);
    const configured = isGoCardlessConfigured();
    const connected = connection?.status === 'connected';

    const { count } = await admin
      .from('gocardless_mandate_links')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('decision', 'pending');

    return roundsJson({
      state,
      configured,
      connectedEmail: connected ? connection.connected_email : null,
      existingToLink: count ?? 0,
      verifyUrl: state === 'needs_details' && configured ? goCardlessConfig().verifyUrl : null,
    });
  } catch (err) {
    return unexpected('GET /api/rounds/direct-debit', err);
  }
}
