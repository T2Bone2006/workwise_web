'use server';

import { getOwnerTenantId } from '@/lib/auth/require-owner';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { releaseWaitingForTenant, type ReleaseResult } from '@/lib/messaging/release-waiting';
import { createAdminClient } from '@/lib/supabase/admin';

/** Dashboard "Send waiting messages" button. */
export async function sendWaitingMessages(): Promise<(ReleaseResult & { sent: number }) | { error: string }> {
  const tenantId = await getOwnerTenantId();
  if (!tenantId) return { error: 'Not signed in' };

  const products = await getTenantProducts();
  if (!products.hasRounds) return { error: 'Waiting messages are part of Rounds.' };

  try {
    const admin = createAdminClient();
    const { count, error } = await admin
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'waiting_texts');
    if (error) return { error: 'Could not check waiting messages' };
    if (!count) return { error: 'Nothing is waiting' };
    const result = await releaseWaitingForTenant(admin, tenantId);
    return { ...result, sent: result.released };
  } catch (err) {
    console.error('[sendWaitingMessages]', err);
    return { error: 'Could not send waiting messages' };
  }
}
