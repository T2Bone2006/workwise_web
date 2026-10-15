import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * "Looks fine": the owner has checked a customer a member of staff added (D6). Only the checked mark changes: never the
 * customer's name, phone, address, agreement or price. Without a customer id it checks every unchecked one in the business.
 * Safe to run twice: the second run changes 0.
 */
export async function markCheckedCore(
  db: SupabaseClient,
  p: { tenantId: string; customerId?: string; now?: Date },
): Promise<{ ok: true; changed: number } | { ok: false; error: string }> {
  let query = db
    .from('customers')
    .update({ added_checked_at: (p.now ?? new Date()).toISOString() })
    .eq('tenant_id', p.tenantId)
    .not('added_by_worker_id', 'is', null)
    .is('added_checked_at', null);
  if (p.customerId) query = query.eq('id', p.customerId);
  const { data, error } = await query.select('id');
  if (error) {
    console.error('[added-by] mark checked:', error.message);
    return { ok: false, error: 'Could not mark that as checked. Try again.' };
  }
  return { ok: true, changed: Array.isArray(data) ? data.length : 0 };
}
