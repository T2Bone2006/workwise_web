'use server';

import { getOwnerTenantId } from '@/lib/auth/require-owner';
import { createAdminClient } from '@/lib/supabase/admin';

/** Dashboard "Mark sorted" on the Didn't-get-it list. Scoped to the owner's own business. */
export async function markNotDeliveredSorted(messageId: string): Promise<{ ok: true } | { error: string }> {
  const tenantId = await getOwnerTenantId();
  if (!tenantId) return { error: 'Not signed in' };
  if (!/^[0-9a-f-]{36}$/i.test(messageId)) return { error: 'Unknown message' };
  const { error } = await createAdminClient()
    .from('messages')
    .update({ handled_at: new Date().toISOString(), handled_action: 'dismissed' })
    .eq('id', messageId)
    .eq('tenant_id', tenantId)
    .eq('status', 'skipped');
  return error ? { error: 'Could not update' } : { ok: true };
}
